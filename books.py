"""Independent durable company books. Amounts are positive debit internally."""
import copy
import datetime as dt
import hashlib
import json
import re
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from billing_rules import default_billing_profiles, evaluate_billing_formula, validate_billing_profiles

GROUP_PARENTS = {
    'Capital Account':'Primary','Loans (Liability)':'Primary','Current Liabilities':'Primary',
    'Fixed Assets':'Primary','Investments':'Primary','Current Assets':'Primary',
    'Misc. Expenses (ASSET)':'Primary','Branch / Divisions':'Primary',
    'Sales Accounts':'Primary','Purchase Accounts':'Primary','Direct Incomes':'Primary',
    'Direct Expenses':'Primary','Indirect Incomes':'Primary','Indirect Expenses':'Primary',
    'Bank OCC A/c':'Loans (Liability)','Bank OD A/c':'Loans (Liability)',
    'Secured Loans':'Loans (Liability)','Unsecured Loans':'Loans (Liability)',
    'Duties & Taxes':'Current Liabilities','Provisions':'Current Liabilities','Sundry Creditors':'Current Liabilities',
    'Stock-in-hand':'Current Assets','Deposits (Asset)':'Current Assets','Loans & Advances (Asset)':'Current Assets',
    'Sundry Debtors':'Current Assets','Cash-in-hand':'Current Assets','Bank Accounts':'Current Assets'
}
VOUCHER_TYPES = ['Contra','Payment','Receipt','Journal','Sales','Purchase','Credit Note','Debit Note',
                 'Sales Order','Purchase Order','Delivery Note','Receipt Note','Rejections In','Rejections Out',
                 'Stock Journal','Physical Stock',
                 'Attendance','Job Work In Order','Job Work Out Order','Material In','Material Out',
                 'Memorandum','Payroll','Reversing Journal']
KINDS = {'ledger':'ledgers','stock_item':'stock_items','group':'groups','unit':'units','godown':'godowns',
         'voucher_type':'voucher_types','stock_group':'stock_groups','stock_category':'stock_categories',
         'cost_category':'cost_categories','cost_centre':'cost_centres','currency':'currencies'}
NON_ACCOUNTING = {'Sales Order','Purchase Order','Delivery Note','Receipt Note','Rejections In','Rejections Out',
                  'Stock Journal','Physical Stock',
                  'Attendance','Job Work In Order','Job Work Out Order','Material In','Material Out',
                  'Memorandum','Payroll','Reversing Journal'}


class InventoryWarning(ValueError):
    def __init__(self, warnings, token):
        super().__init__('Inventory warning acknowledgement required')
        self.warnings = warnings
        self.token = token


def decimal(value, quantum=None):
    try: amount = Decimal(str(value or 0).replace(',', '').split()[0])
    except (InvalidOperation, IndexError): raise ValueError('Invalid numeric amount')
    if not amount.is_finite(): raise ValueError('Amount must be finite')
    return amount.quantize(Decimal(quantum), rounding=ROUND_HALF_UP) if quantum else amount


def date_key(value):
    text = str(value or '').strip()
    for fmt in ('%Y%m%d','%Y-%m-%d','%d-%b-%Y','%d-%b-%y','%d-%m-%Y','%d/%m/%Y'):
        try: return dt.datetime.strptime(text, fmt).strftime('%Y%m%d')
        except ValueError: pass
    raise ValueError('Invalid date: use DD-MMM-YYYY or YYYY-MM-DD')


def entries(voucher, key='ALLLEDGERENTRIES.LIST'):
    result = voucher.get(key) or ([] if key != 'ALLLEDGERENTRIES.LIST' else voucher.get('LEDGERENTRIES.LIST', []))
    return [result] if isinstance(result, dict) else result


def entry_debit(entry):
    value = decimal(entry.get('AMOUNT'), '0.01')
    flag = str(entry.get('ISDEEMEDPOSITIVE','')).lower()
    return abs(value) if flag == 'yes' else -abs(value) if flag == 'no' else -value


def effective(voucher):
    return not any(str(voucher.get(k,'No')).lower() == 'yes' for k in ('CANCELLED','ISCANCELLED','ISOPTIONAL'))


def _party_classification(company, name):
    ledger = company.get('ledgers', {}).get(name, {})
    group = ledger.get('parent')
    seen = set()
    while group and group not in seen:
        seen.add(group)
        record = company.get('group_records', {}).get(group, {})
        system_group = record.get('system_group') or group
        if system_group == 'Sundry Debtors': return 'debtor'
        if system_group == 'Sundry Creditors': return 'creditor'
        group = record.get('parent', GROUP_PARENTS.get(group))
    return None


def _unit_record(units, name):
    if isinstance(units, dict):
        record = units.get(name)
        if record is None:
            for key, value in units.items():
                if str(key).lower() == str(name).lower():
                    record = value
                    break
    else:
        record = next((value for value in units or []
                       if (value.get('name') if isinstance(value, dict) else value) == name), None)
    if isinstance(record, str):
        return {'name': record, 'type': 'quantity', 'factor': '1'}
    if not isinstance(record, dict):
        raise ValueError('Unknown unit: ' + str(name))
    return {'name': name, 'type': record.get('type') or record.get('dimension') or 'quantity',
            'base_unit': record.get('base_unit') or name,
            'factor': record.get('factor') or '1',
            **record}


def _unit_path(units, name):
    current = str(name or '').strip()
    if not current:
        raise ValueError('Unit is required')
    seen = set()
    total = Decimal('1')
    dimension = None
    while current:
        if current.lower() in seen:
            raise ValueError('Unit conversion cycle detected')
        seen.add(current.lower())
        record = _unit_record(units, current)
        dimension = dimension or str(record.get('type') or 'quantity').strip().lower()
        if str(record.get('type') or 'quantity').strip().lower() != dimension:
            raise ValueError('Unit dimensions do not match')
        total *= decimal(record.get('factor', '1'))
        base = str(record.get('base_unit') or current).strip()
        if base.lower() == current.lower():
            return base, total, dimension, record
        current = base
    raise ValueError('Invalid unit definition')


def parse_compound_quantity(text, unit_record):
    source = str(text or '').strip()
    match = re.fullmatch(r'([+-]?\d+(?:\.\d+)?)\s*([A-Za-z][A-Za-z0-9 _/-]*)?', source)
    if not match:
        raise ValueError('Invalid compound quantity')
    suffix = str(match.group(2) or '').strip()
    expected = str(unit_record.get('name') or '') if isinstance(unit_record, dict) else ''
    if suffix and expected and suffix.lower() != expected.lower():
        raise ValueError('Quantity unit does not match')
    return decimal(match.group(1))


def convert_quantity(quantity, from_unit, to_unit, units):
    from_base, from_factor, from_dimension, _ = _unit_path(units, from_unit)
    to_base, to_factor, to_dimension, to_record = _unit_path(units, to_unit)
    if from_dimension != to_dimension or from_base.lower() != to_base.lower():
        raise ValueError('Unit dimensions do not match')
    result = decimal(quantity) * from_factor / to_factor
    places = to_record.get('decimal_places')
    if places not in (None, ''):
        result = result.quantize(Decimal('1').scaleb(-int(places)), rounding=ROUND_HALF_UP)
    return result


def _quantity_in_base(company, item_record, quantity):
    text = str(quantity or '').strip()
    match = re.fullmatch(r'([+-]?\d+(?:\.\d+)?)\s*([A-Za-z][A-Za-z0-9 _/-]*)?', text)
    if not match:
        raise ValueError('Invalid inventory quantity')
    numeric = decimal(match.group(1))
    source_unit = str(match.group(2) or item_record.get('base_units') or '').strip()
    target_unit = str(item_record.get('base_units') or source_unit).strip()
    if not source_unit or not target_unit:
        return numeric
    units = company.get('unit_records', {})
    if not units:
        return numeric
    return convert_quantity(numeric, source_unit, target_unit, units)


def value_stock_issue(layers, quantity, method='fifo'):
    wanted = decimal(quantity, '0.01')
    if wanted < 0:
        raise ValueError('Issue quantity cannot be negative')
    if method not in ('fifo', 'moving_average'):
        raise ValueError('Unknown valuation method')
    remaining = wanted
    value = Decimal('0.00')
    working = [dict(layer, quantity=decimal(layer.get('quantity', 0), '0.01'),
                    rate=decimal(layer.get('rate', 0), '0.01')) for layer in layers]
    if method == 'moving_average':
        available = sum((row['quantity'] for row in working), Decimal('0.00'))
        total = sum((row['quantity'] * row['rate'] for row in working), Decimal('0.00'))
        rate = total / available if available else Decimal('0.00')
        consumed = min(wanted, available)
        value = consumed * rate
        remaining = wanted - consumed
    else:
        for layer in working:
            if remaining <= 0:
                break
            take = min(remaining, layer['quantity'])
            value += take * layer['rate']
            remaining -= take
    shortage = remaining
    if shortage:
        fallback = working[-1]['rate'] if working else Decimal('0.00')
        value += shortage * fallback
    return {'quantity': str(wanted.quantize(Decimal('.01'))),
            'value': str(value.quantize(Decimal('.01'), rounding=ROUND_HALF_UP)),
            'shortage': str(shortage.quantize(Decimal('.01'))),
            'provisional': bool(shortage)}


def _report_decimal(value):
    return str(decimal(value, '0.01'))


def _report_context_token(company, report, period, node_type, node_id):
    payload = json.dumps({'company': company, 'report': report, 'period': period,
                          'node_type': node_type, 'node_id': node_id},
                         sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def drill_context(node):
    required = ('company', 'report', 'period', 'node_type', 'node_id', 'context_token')
    if not isinstance(node, dict) or any(key not in node for key in required):
        raise ValueError('Invalid drill context')
    expected = _report_context_token(node['company'], node['report'], node['period'],
                                     node['node_type'], node['node_id'])
    if node['context_token'] != expected:
        raise ValueError('Invalid drill context')
    period = node['period']
    if not isinstance(period, dict) or not period.get('id') or not period.get('from') or not period.get('to'):
        raise ValueError('Invalid drill context period')
    return {key: node[key] for key in ('company', 'report', 'period', 'node_type', 'node_id')}


def fifo_layers(company, item, godown, batch=None, as_of=None):
    if item not in company.get('stock_items', {}):
        raise ValueError('Unknown stock item: ' + str(item))
    cutoff = date_key(as_of) if as_of else None
    item_record = company['stock_items'][item]
    layers = []
    opening_qty = _quantity_in_base(company, item_record, item_record.get('opening_qty', 0))
    if opening_qty:
        opening_value = decimal(item_record.get('opening_balance', 0), '0.01')
        layers.append({'quantity': str(opening_qty.quantize(Decimal('.01'))),
                       'rate': str((opening_value / opening_qty if opening_qty else 0).quantize(Decimal('.01'))),
                       'date': company.get('starting_from', ''), 'voucher_id': 'opening',
                       'godown': 'Main Location', 'batch': ''})
    ordered = sorted(company.get('vouchers', []), key=lambda value: (
        date_key(value.get('DATE')), str(value.get('MASTERID', ''))))
    for voucher in ordered:
        if not effective(voucher) or (cutoff and date_key(voucher.get('DATE')) > cutoff):
            continue
        base = company.get('voucher_type_records', {}).get(voucher.get('VOUCHERTYPENAME'), {}).get(
            'base_type', voucher.get('VOUCHERTYPENAME'))
        direction = -1 if base in ('Sales', 'Delivery Note', 'Debit Note', 'Rejections Out') else 1 if base in (
            'Purchase', 'Receipt Note', 'Credit Note', 'Rejections In') else 0
        if not direction:
            continue
        for key in ('ALLINVENTORYENTRIES.LIST', 'INVENTORYENTRIES.LIST'):
            for row in entries(voucher, key):
                if row.get('STOCKITEMNAME') != item:
                    continue
                allocations = entries(row, 'BATCHALLOCATIONS.LIST') or [{
                    'GODOWNNAME': 'Main Location', 'BATCHNAME': '',
                    'ACTUALQTY': row.get('ACTUALQTY', row.get('BILLEDQTY', 0)),
                    'AMOUNT': row.get('AMOUNT', 0),
                }]
                for allocation in allocations:
                    location = str(allocation.get('GODOWNNAME') or 'Main Location')
                    allocation_batch = str(allocation.get('BATCHNAME') or '')
                    if location != godown or (batch is not None and allocation_batch != str(batch)):
                        continue
                    qty = _quantity_in_base(company, item_record,
                                            allocation.get('ACTUALQTY') or allocation.get('BILLEDQTY') or 0)
                    if qty <= 0:
                        continue
                    amount = abs(decimal(allocation.get('AMOUNT') or row.get('AMOUNT') or 0, '0.01'))
                    rate = amount / qty if qty else Decimal('0.00')
                    if direction > 0:
                        layers.append({'quantity': str(qty.quantize(Decimal('.01'))),
                                       'rate': str(rate.quantize(Decimal('.01'))),
                                       'date': voucher.get('DATE', ''),
                                       'voucher_id': voucher.get('MASTERID', ''),
                                       'godown': location, 'batch': allocation_batch})
                    else:
                        remaining = qty
                        for layer in layers:
                            if remaining <= 0:
                                break
                            if layer.get('godown') != location or (batch is not None and layer.get('batch') != str(batch)):
                                continue
                            take = min(remaining, Decimal(layer['quantity']))
                            layer['quantity'] = str((Decimal(layer['quantity']) - take).quantize(Decimal('.01')))
                            remaining -= take
                        layers = [layer for layer in layers if decimal(layer['quantity']) > 0]
    return layers


def party_outstanding(company, name):
    """Return the current signed balance and bill count for a party ledger."""
    if name not in company.get('ledgers', {}): raise ValueError('Unknown party ledger: '+str(name))
    ledger = company['ledgers'][name]
    signed = decimal(ledger.get('signed_closing', 0), '0.01')
    if not signed and ledger.get('closing_balance'):
        signed = decimal(ledger.get('closing_balance'), '0.01')
        if str(ledger.get('closing_drcr', 'Dr')).lower() == 'cr': signed = -signed
    bills = [*company.get('bills_receivable', []), *company.get('bills_payable', [])]
    bill_count = sum(1 for bill in bills if bill.get('ledger') == name and bill.get('name') != 'On Account')
    return {'ledger':name, 'amount':str(abs(signed).quantize(Decimal('0.01'))),
            'drcr':'Cr' if signed < 0 else 'Dr',
            'classification':_party_classification(company, name) or 'party', 'bill_count':bill_count}


def gst_components(company, taxable_amount, party_name=None, rate=None):
    """Calculate local CGST/SGST or interstate IGST for an invoice."""
    if not company.get('gstin'): return []
    taxable = decimal(taxable_amount, '0.01')
    party = company.get('ledgers', {}).get(party_name or '', {})
    tax_rate = decimal(rate if rate not in (None, '') else party.get('tax_rate', 0))
    if taxable <= 0 or tax_rate <= 0: return []
    total = (taxable * tax_rate / Decimal('100')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    same_state = not party.get('state') or not company.get('state') or str(party.get('state')).strip().lower() == str(company.get('state')).strip().lower()
    if not same_state: return [{'ledger':'IGST','amount':str(total),'drcr':'Cr','rate':f'{tax_rate:.2f}'}]
    half_rate = tax_rate / Decimal('2')
    cgst = (total / Decimal('2')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    sgst = total - cgst
    return [{'ledger':'CGST','amount':str(cgst),'drcr':'Cr','rate':f'{half_rate:.2f}'},
            {'ledger':'SGST','amount':str(sgst),'drcr':'Cr','rate':f'{half_rate:.2f}'}]

def calculate_item_gst(company, party_name, items):
    if not company.get('gstin'):
        return []
    party = company.get('ledgers', {}).get(party_name or '', {})
    party_state = str(party.get('state') or '').strip().lower()
    company_state = str(company.get('state') or '').strip().lower()
    same_state = not party_state or not company_state or party_state == company_state

    totals = {}
    for entry in items:
        item_name = entry.get('item') or entry.get('STOCKITEMNAME')
        item_record = company.get('stock_items', {}).get(item_name or '', {})
        rate_val = entry.get('gst_rate') if 'gst_rate' in entry else entry.get('rate', item_record.get('gst_rate', 0))
        rate = decimal(rate_val if rate_val not in (None, '') else 0)
        if rate <= Decimal('0'):
            continue
        amt = decimal(entry.get('amount') or entry.get('itemamount') or 0, '0.01')
        if amt <= Decimal('0'):
            continue
        tax = (amt * rate / Decimal('100')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        if same_state:
            cgst = (tax / Decimal('2')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            sgst = tax - cgst
            totals['CGST'] = totals.get('CGST', Decimal('0.00')) + cgst
            totals['SGST'] = totals.get('SGST', Decimal('0.00')) + sgst
        else:
            totals['IGST'] = totals.get('IGST', Decimal('0.00')) + tax

    result = []
    if same_state:
        if 'CGST' in totals and totals['CGST'] > Decimal('0'):
            result.append({'ledger': 'CGST', 'amount': str(totals['CGST']), 'drcr': 'Cr'})
        if 'SGST' in totals and totals['SGST'] > Decimal('0'):
            result.append({'ledger': 'SGST', 'amount': str(totals['SGST']), 'drcr': 'Cr'})
    else:
        if 'IGST' in totals and totals['IGST'] > Decimal('0'):
            result.append({'ledger': 'IGST', 'amount': str(totals['IGST']), 'drcr': 'Cr'})
    return result



class Books:
    def __init__(self, path):
        self.data_file = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self._depth = 0
        self.connection = sqlite3.connect(path, check_same_thread=False, timeout=15)
        self.connection.execute('PRAGMA journal_mode=WAL')
        self.connection.execute('PRAGMA synchronous=FULL')
        self.connection.execute('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)')
        self.connection.execute('CREATE TABLE IF NOT EXISTS history (revision INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT NOT NULL, payload TEXT NOT NULL)')
        row = self.connection.execute('SELECT payload FROM state WHERE id=1').fetchone()
        self.data = json.loads(row[0]) if row else {'version':1,'revision':0,'active_company':'','companies':{}}
        if not row: self.save()

    @contextmanager
    def transaction(self):
        with self.lock:
            outer = self._depth == 0
            before = copy.deepcopy(self.data) if outer else None
            self._depth += 1
            try:
                yield
                if outer: self._persist()
            except Exception:
                if outer: self.data = before
                raise
            finally: self._depth -= 1

    def _persist(self):
        self.data['revision'] = int(self.data.get('revision',0))+1
        payload = json.dumps(self.data, ensure_ascii=False, allow_nan=False)
        with self.connection:
            self.connection.execute('INSERT OR REPLACE INTO state(id,payload) VALUES(1,?)',(payload,))
            self.connection.execute('INSERT INTO history(time,payload) VALUES(?,?)',(dt.datetime.now(dt.timezone.utc).isoformat(),payload))

    def save(self):
        with self.lock:
            if not self._depth: self._persist()

    def get_active_company_name(self): return self.data['active_company']

    def get_company(self, name=None):
        target = self.get_active_company_name() if name is None else name
        if not target and not self.data['companies']: return {}
        if target not in self.data['companies']: raise ValueError('Unknown company: '+str(target))
        return self.data['companies'][target]

    def set_active_company_name(self,name):
        with self.transaction():
            self.get_company(name)
            self.data['active_company'] = name

    def get_companies_list(self):
        return [dict(name=c['name'], number=c['company_number'], guid=c['guid'],
                     starting_from=c['starting_from'], ending_at=c['ending_at'],
                     gstin=c.get('gstin',''), state=c.get('state','')) for c in self.data['companies'].values()]

    def last_narration(self, company, voucher_type, exclude_master_id=None):
        """Return the newest non-empty narration for a voucher type without writing state."""
        with self.lock:
            c = self.get_company(company)
            candidates = [
                voucher for voucher in c.get('vouchers', [])
                if voucher.get('VOUCHERTYPENAME') == voucher_type
                and effective(voucher)
                and str(voucher.get('NARRATION') or '').strip()
                and str(voucher.get('MASTERID')) != str(exclude_master_id or '')
            ]
            candidates.sort(key=lambda voucher: (
                date_key(voucher.get('DATE')), str(voucher.get('MASTERID', ''))
            ), reverse=True)
            return str(candidates[0].get('NARRATION')).strip() if candidates else ''

    def voucher_mode_defaults(self, company, voucher_type):
        """Read mode preferences while preserving legacy companies unchanged."""
        with self.lock:
            c = self.get_company(company)
            configured = c.get('voucher_mode_defaults', {}).get(voucher_type, {})
            return {
                'mode': configured.get('mode', 'invoice') if voucher_type in ('Sales', 'Purchase') else 'voucher',
                'accounting_mode': configured.get('accounting_mode', 'accounting_invoice'),
            }

    def billing_profiles(self, company):
        with self.lock:
            configured = self.get_company(company).get('billing_profiles')
            return copy.deepcopy(validate_billing_profiles(configured)) if configured else default_billing_profiles()

    def save_billing_profiles(self, company, profiles, expected_revision=None):
        validated = validate_billing_profiles(profiles)
        with self.transaction():
            if expected_revision is not None and int(expected_revision) != int(self.data.get('revision', 0)):
                raise ValueError('stale books revision')
            self.get_company(company)['billing_profiles'] = copy.deepcopy(validated)
            return copy.deepcopy(validated)

    def validate_billing_rows(self, company, voucher_type, rows, client_amounts=None):
        profile = self.billing_profiles(company).get(voucher_type)
        if profile is None:
            raise ValueError('No billing profile for '+str(voucher_type))
        if not isinstance(rows, list):
            raise ValueError('Billing rows must be a list')
        client_amounts = client_amounts or []
        numeric = {field['key'] for field in profile['fields'] if field['kind'] in ('number', 'calculated')}
        required = {field['key'] for field in profile['fields'] if field.get('required') and field['key'] != 'amount'}
        result = []
        for index, source in enumerate(rows):
            if not isinstance(source, dict): raise ValueError('Billing row '+str(index + 1)+' must be an object')
            if any(not str(source.get(key) or '').strip() for key in required):
                raise ValueError('Required billing field missing on row '+str(index + 1))
            values = {key: source.get(key, '0') for key in numeric if key != 'amount'}
            calculated = evaluate_billing_formula(profile['formula'], values)
            supplied = source.get('amount')
            if supplied not in (None, ''):
                if decimal(supplied, '0.01') != calculated:
                    raise ValueError('Billing amount mismatch on row '+str(index + 1))
            if index < len(client_amounts) and client_amounts[index] not in (None, ''):
                if decimal(client_amounts[index], '0.01') != calculated:
                    raise ValueError('Billing amount mismatch on row '+str(index + 1))
            normalized = copy.deepcopy(source)
            normalized['amount'] = str(calculated)
            result.append(normalized)
        return result

    def inventory_policy(self, company):
        with self.lock:
            c = self.get_company(company)
            policy = str(c.get('negative_stock_policy', 'warn')).lower()
            if policy not in ('warn', 'block'):
                policy = 'warn'
            return {'negative_stock_policy': policy}

    def _validate_inventory_allocations(self, company, voucher):
        for key in ('ALLINVENTORYENTRIES.LIST', 'INVENTORYENTRIES.LIST',
                    'CONSUMPTIONENTRIES.LIST', 'PRODUCTIONENTRIES.LIST',
                    'PHYSICALSTOCKENTRIES.LIST'):
            for row in entries(voucher, key):
                name = str(row.get('STOCKITEMNAME') or '')
                if not name:
                    continue
                item = company.get('stock_items', {}).get(name)
                if not item:
                    raise ValueError('Unknown stock item: ' + name)
                quantity = abs(_quantity_in_base(company, item,
                                                  row.get('ACTUALQTY', row.get('BILLEDQTY', 0))))
                allocations = entries(row, 'BATCHALLOCATIONS.LIST')
                if not allocations:
                    continue
                total = Decimal('0.00')
                for allocation in allocations:
                    godown = str(allocation.get('GODOWNNAME') or 'Main Location')
                    if godown not in company.get('godowns', []):
                        raise ValueError('Unknown godown: ' + godown)
                    expiry = str(allocation.get('EXPIRYDATE') or '').strip()
                    if expiry:
                        date_key(expiry)
                    part = abs(_quantity_in_base(company, item,
                                                 allocation.get('ACTUALQTY', allocation.get('BILLEDQTY', 0))))
                    total += part
                if total != quantity:
                    raise ValueError('Inventory allocations must equal line quantity')

    def preview_inventory_posting(self, company, voucher):
        with self.lock:
            c = self.get_company(company)
            candidate = copy.deepcopy(voucher)
            self._validate_voucher(c, candidate)
            self._validate_inventory_allocations(c, candidate)
            warnings, errors, valuation = [], [], []
            base = c.get('voucher_type_records', {}).get(candidate.get('VOUCHERTYPENAME'), {}).get(
                'base_type', candidate.get('VOUCHERTYPENAME'))
            direction = -1 if base in ('Sales', 'Delivery Note', 'Debit Note', 'Rejections Out') else 1 if base in (
                'Purchase', 'Receipt Note', 'Credit Note', 'Rejections In') else 0
            if direction < 0:
                for row in entries(candidate, 'ALLINVENTORYENTRIES.LIST') or entries(candidate, 'INVENTORYENTRIES.LIST'):
                    name = row.get('STOCKITEMNAME')
                    item = c['stock_items'][name]
                    qty = abs(_quantity_in_base(c, item, row.get('ACTUALQTY', row.get('BILLEDQTY', 0))))
                    allocations = entries(row, 'BATCHALLOCATIONS.LIST') or [{'GODOWNNAME': 'Main Location', 'BATCHNAME': ''}]
                    for allocation in allocations:
                        godown = str(allocation.get('GODOWNNAME') or 'Main Location')
                        batch = str(allocation.get('BATCHNAME') or '')
                        layers = fifo_layers(c, name, godown, batch, candidate.get('DATE'))
                        method = str(item.get('valuation_method') or c.get('valuation_method') or 'moving_average').lower()
                        result = value_stock_issue(layers, qty, 'fifo' if method == 'fifo' else 'moving_average')
                        valuation.append({'item': name, 'godown': godown, 'batch': batch, **result})
                        if Decimal(result['shortage']) > 0:
                            warning = {'kind': 'negative_stock', 'item': name, 'godown': godown,
                                       'quantity': result['shortage'], 'provisional': result['provisional']}
                            if self.inventory_policy(company)['negative_stock_policy'] == 'block':
                                errors.append(warning)
                            else:
                                warnings.append(warning)
            token = self.inventory_warning_token(company, candidate, self.data.get('revision', 0))
            return {'warnings': warnings, 'errors': errors, 'valuation': valuation,
                    'warning_token': token}

    @staticmethod
    def inventory_warning_token(company, voucher, revision):
        normalized = copy.deepcopy(voucher)
        normalized.pop('@ACTION', None)
        payload = json.dumps({'company': company, 'voucher': normalized, 'revision': int(revision)},
                             sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(payload.encode('utf-8')).hexdigest()

    @staticmethod
    def _bill_id(ledger, name, source_voucher_id):
        raw = '%s\x1f%s\x1f%s' % (ledger, name, source_voucher_id)
        return 'bill-' + hashlib.sha1(raw.encode('utf-8')).hexdigest()[:20]

    @staticmethod
    def _due_date(bill_date, allocation):
        due = str(allocation.get('DUEDATE') or '').strip()
        if due:
            return date_key(due)
        credit = str(allocation.get('CREDITPERIOD') or '').strip()
        match = re.search(r'(\d+)', credit)
        if match and bill_date:
            date = dt.datetime.strptime(date_key(bill_date), '%Y%m%d').date()
            return (date + dt.timedelta(days=int(match.group(1)))).strftime('%Y%m%d')
        return ''

    def _bill_rows(self, company, as_of=None, exclude_voucher_id=None):
        cutoff = date_key(as_of) if as_of else None
        rows = {}
        by_name = {}
        def ensure_row(bill_id, ledger, name, party, bill_date='', due_date='',
                       source='', reference_kind='bill'):
            return rows.setdefault(bill_id, {
                'bill_id': bill_id, 'name': name, 'ledger': ledger, 'party': party,
                'date': date_key(bill_date) if bill_date else '',
                'due_date': due_date,
                'original': Decimal('0.00'), 'signed_pending': Decimal('0.00'),
                'pending': Decimal('0.00'), 'source_voucher_id': source,
                'reference_kind': reference_kind,
            })
        def signed_part(amount, signed_entry):
            return amount if signed_entry >= 0 else -amount

        for ledger, record in company.get('ledgers', {}).items():
            party = _party_classification(company, ledger)
            opening = decimal(record.get('signed_opening', 0), '0.01')
            if party and opening:
                bill_id = self._bill_id(ledger, 'On Account', 'opening')
                row = ensure_row(bill_id, ledger, 'On Account', party,
                                 company.get('starting_from', ''), '', 'opening', 'unallocated')
                row['signed_pending'] += opening
        ordered = sorted(company.get('vouchers', []), key=lambda voucher: (
            date_key(voucher.get('DATE')), int(str(voucher.get('MASTERID', '')).split('-')[-1])
            if str(voucher.get('MASTERID', '')).split('-')[-1].isdigit() else 0,
            str(voucher.get('MASTERID', ''))))
        for voucher in ordered:
            if not effective(voucher) or str(voucher.get('MASTERID')) == str(exclude_voucher_id or ''):
                continue
            if cutoff and date_key(voucher.get('DATE')) > cutoff:
                continue
            base = company.get('voucher_type_records', {}).get(voucher.get('VOUCHERTYPENAME'), {}).get(
                'base_type', voucher.get('VOUCHERTYPENAME'))
            if base in NON_ACCOUNTING:
                continue
            for entry in entries(voucher):
                ledger = str(entry.get('LEDGERNAME') or '')
                if not ledger or ledger not in company.get('ledgers', {}):
                    continue
                party = _party_classification(company, ledger)
                if not party:
                    continue
                allocations = entries(entry, 'BILLALLOCATIONS.LIST')
                entry_amount = abs(entry_debit(entry))
                allocated_amount = Decimal('0.00')
                signed_entry = entry_debit(entry)
                for allocation in allocations:
                    name = str(allocation.get('NAME') or '').strip()
                    method = str(allocation.get('BILLTYPE') or 'New Ref')
                    value = abs(decimal(allocation.get('AMOUNT') or entry.get('AMOUNT'), '0.01'))
                    if not value:
                        continue
                    allocated_amount += value
                    if method == 'New Ref':
                        source = str(voucher.get('MASTERID') or voucher.get('GUID') or '')
                        if not name:
                            name = 'On Account'
                        bill_id = str(allocation.get('BILLID') or self._bill_id(ledger, name, source))
                        bill_date = str(allocation.get('BILLDATE') or voucher.get('DATE') or '')
                        row = ensure_row(bill_id, ledger, name, party, bill_date,
                                         self._due_date(bill_date, allocation), source)
                        row['original'] += value
                        row['signed_pending'] += signed_part(value, signed_entry)
                        by_name.setdefault((ledger, name), []).append(bill_id)
                    elif method == 'Agst Ref':
                        candidate = str(allocation.get('BILLID') or '')
                        candidates = list(set(by_name.get((ledger, name), []))) if not candidate else []
                        if not candidate and len(candidates) == 1:
                            candidate = candidates[0]
                        if candidate in rows and rows[candidate]['ledger'] == ledger:
                            rows[candidate]['signed_pending'] += signed_part(value, signed_entry)
                        else:
                            source = str(voucher.get('MASTERID') or voucher.get('GUID') or '')
                            fallback = self._bill_id(ledger, name or 'On Account', source)
                            row = ensure_row(fallback, ledger, name or 'On Account', party,
                                             voucher.get('DATE', ''), '', source, 'unallocated')
                            row['signed_pending'] += signed_part(value, signed_entry)
                            row['resolution'] = 'ambiguous' if len(candidates) > 1 else 'unresolved'
                    elif method in ('On Account', 'Advance'):
                        label = name or method
                        source = str(voucher.get('MASTERID') or voucher.get('GUID') or '')
                        bill_id = str(allocation.get('BILLID') or self._bill_id(ledger, label, source))
                        row = ensure_row(bill_id, ledger, label, party, voucher.get('DATE', ''), '', source,
                                         'unallocated')
                        row['signed_pending'] += signed_part(value, signed_entry)
                residual = entry_amount - allocated_amount
                if residual > 0:
                    source = str(voucher.get('MASTERID') or voucher.get('GUID') or '')
                    bill_id = self._bill_id(ledger, 'On Account', source)
                    row = ensure_row(bill_id, ledger, 'On Account', party, voucher.get('DATE', ''), '', source,
                                     'unallocated')
                    row['signed_pending'] += signed_part(residual, signed_entry)
        result = []
        for row in rows.values():
            row['pending'] = abs(row['signed_pending'])
            if not row['pending']:
                continue
            item = dict(row)
            item['original'] = str(item['original'].quantize(Decimal('.01')))
            item['pending'] = str(item['pending'].quantize(Decimal('.01')))
            item['signed_pending'] = str(item['signed_pending'].quantize(Decimal('.01')))
            item['drcr'] = 'Dr' if row['signed_pending'] >= 0 else 'Cr'
            result.append(item)
        return sorted(result, key=lambda item: (item['date'] or '99999999', item['name'], item['bill_id']))

    def pending_bills(self, company, ledger, as_of=None, exclude_voucher_id=None):
        with self.lock:
            return [row for row in self._bill_rows(self.get_company(company), as_of, exclude_voucher_id)
                    if ledger is None or row['ledger'] == ledger]

    def _normalize_bill_allocations(self, company, ledger, amount, method, allocations,
                                    as_of=None, exclude_voucher_id=None):
        if not _party_classification(company, ledger):
            raise ValueError('Select a debtor or creditor party ledger')
        total = decimal(amount, '0.01').copy_abs()
        if total <= 0:
            raise ValueError('Allocation amount must be positive')
        if method not in ('New Ref', 'Agst Ref', 'Advance', 'On Account'):
            raise ValueError('Unknown allocation method')
        rows = allocations or []
        pending = {row['bill_id']: row for row in self._bill_rows(company, as_of, exclude_voucher_id)
                   if row['ledger'] == ledger and row.get('reference_kind') == 'bill'}
        normalized = []
        allocated = Decimal('0.00')
        by_bill = {}
        for row in rows:
            row_method = row.get('method') or method
            if row_method not in ('New Ref', 'Agst Ref', 'Advance', 'On Account'):
                raise ValueError('Unknown allocation method')
            bill_id = str(row.get('bill_id') or '').strip()
            name = str(row.get('name') or '').strip()
            bill = pending.get(bill_id) if row_method == 'Agst Ref' else None
            if row_method == 'Agst Ref' and bill_id and not bill:
                all_bills = {item['bill_id']: item for item in self._bill_rows(company)}
                if bill_id in all_bills:
                    raise ValueError('Allocation belongs to another party')
                raise ValueError('Unknown bill ID')
            if row_method == 'Agst Ref' and not bill and not bill_id and name:
                matches = [item for item in pending.values() if item['name'] == name]
                if len(matches) > 1:
                    raise ValueError('ambiguous bill reference')
                bill = matches[0] if matches else None
            value = decimal(row.get('amount'), '0.01').copy_abs()
            if row_method == 'Agst Ref':
                if not bill:
                    raise ValueError('Bill reference is required for Agst Ref')
                by_bill[bill['bill_id']] = by_bill.get(bill['bill_id'], Decimal('0.00')) + value
                if by_bill[bill['bill_id']] > decimal(bill['pending'], '0.01'):
                    raise ValueError('Allocation exceeds pending bill amount')
            if value <= 0:
                raise ValueError('Allocation amount must be positive')
            if row_method in ('New Ref', 'Advance') and not name:
                raise ValueError('Reference name is required')
            allocated += value
            item = {**copy.deepcopy(row), 'bill_id': bill['bill_id'] if bill else bill_id,
                               'name': bill['name'] if bill else name,
                               'amount': str(value.quantize(Decimal('.01'))),
                               'method': row_method}
            for field in ('date', 'due_date'):
                if item.get(field):
                    item[field] = date_key(item[field])
            normalized.append(item)
        if allocated > total:
            raise ValueError('Allocation exceeds voucher amount')
        return {'method': method, 'amount': str(total.quantize(Decimal('.01'))),
                'allocations': normalized,
                'residual': str((total - allocated).quantize(Decimal('.01')))}

    def allocate_bill_lines(self, company, ledger, amount, method, allocations,
                            expected_revision, commit=True, as_of=None, exclude_voucher_id=None):
        with self.lock:
            if commit:
                with self.transaction():
                    if int(expected_revision) != int(self.data.get('revision', 0)):
                        raise ValueError('stale books revision')
                    result = self._normalize_bill_allocations(self.get_company(company), ledger,
                                                              amount, method, allocations, as_of, exclude_voucher_id)
                    if decimal(result['residual']):
                        raise ValueError('Allocation sum must equal entry amount; assign the residual explicitly')
                    self.get_company(company).setdefault('allocation_records', []).append({
                        'ledger': ledger, 'state': 'prepared', 'method': method, **result,
                    })
                    return result
            return self._normalize_bill_allocations(self.get_company(company), ledger,
                                                    amount, method, allocations, as_of, exclude_voucher_id)

    def ageing(self, company, ledger=None, as_of=None, basis='due_date'):
        if basis not in ('due_date', 'invoice_date'):
            raise ValueError('Ageing basis must be due_date or invoice_date')
        cutoff = date_key(as_of) if as_of else dt.date.today().strftime('%Y%m%d')
        rows = self.pending_bills(company, ledger, cutoff)
        buckets = {'<30': [], '30-60': [], '60-90': [], '>90': []}
        undated, not_yet_due = [], []
        for row in rows:
            value = row.get('due_date') if basis == 'due_date' else row.get('date')
            if not value:
                undated.append(row);continue
            days = (dt.datetime.strptime(cutoff, '%Y%m%d').date() -
                    dt.datetime.strptime(value, '%Y%m%d').date()).days
            if days < 0 and basis == 'due_date':
                not_yet_due.append(row);continue
            bucket = '<30' if days < 30 else '30-60' if days < 60 else '60-90' if days <= 90 else '>90'
            item = dict(row, age_days=days, bucket=bucket)
            buckets[bucket].append(item)
        return {'as_of': cutoff, 'basis': basis, 'buckets': buckets, 'rows': [*sum(buckets.values(), []), *not_yet_due, *undated],
                'undated': undated, 'not_yet_due': not_yet_due}

    def create_or_alter_company(self, meta):
        with self.transaction():
            name = str(meta.get('name','')).strip()
            if not name: raise ValueError('Company name is required')
            old = str(meta.get('old_name') or name)
            existing = self.data['companies'].get(old)
            if old != name and name in self.data['companies']: raise ValueError('Company name already exists')
            start = date_key(meta.get('starting_from') or (existing or {}).get('starting_from'))
            end = date_key(meta.get('ending_at') or (existing or {}).get('ending_at'))
            if end < start: raise ValueError('Financial year end precedes start')
            if not existing:
                existing = {'name':name,'company_number':str(len(self.data['companies'])+100000),'guid':str(uuid.uuid4()),
                    'groups':list(GROUP_PARENTS),'group_records':{k:{'name':k,'parent':v} for k,v in GROUP_PARENTS.items()},
                    'voucher_types':list(VOUCHER_TYPES),'vouchers':[],'ledgers':{},'stock_items':{},
                    'units':[],'godowns':['Main Location'],'stock_groups':['Primary'],'stock_categories':['Primary'],
                    'cost_categories':['Primary Cost Category'],'cost_centres':[],'currencies':[],
                    'bills_receivable':[],'bills_payable':[],'next_voucher_id':1,
                    'billing_profiles':default_billing_profiles()}
            reserved=set(KINDS.values()) | {'old_name','vouchers','next_voucher_id','guid','company_number','source_imports'}
            existing.update({k:v for k,v in meta.items() if k not in reserved and not k.endswith('_records')})
            existing.update(name=name,starting_from=start,ending_at=end)
            existing['books_from']=date_key(meta.get('books_from') or existing.get('books_from') or start)
            if existing['books_from']<start: raise ValueError('Books beginning date precedes the financial year')
            if old in self.data['companies'] and old != name: del self.data['companies'][old]
            self.data['companies'][name]=existing
            self.data['active_company']=name
            return True

    def delete_company(self, name):
        with self.transaction():
            name = str(name or '').strip()
            if not name: raise ValueError('Company name is required')
            if name not in self.data['companies']: raise ValueError(f'Company "{name}" not found')
            del self.data['companies'][name]
            if self.data.get('active_company') == name:
                remaining = list(self.data['companies'].keys())
                self.data['active_company'] = remaining[0] if remaining else None
            return True

    def root_group(self,company,group):
        seen=set(); records=company.get('group_records',{})
        while group not in seen:
            seen.add(group)
            parent=records.get(group,{}).get('parent',GROUP_PARENTS.get(group,'Primary'))
            if parent == 'Primary': return group
            group=parent
        raise ValueError('Group hierarchy contains a cycle')

    def save_master(self, company, kind, record):
        with self.transaction():
            c=self.get_company(company); field=KINDS[kind]
            name=str(record.get('name') or record.get('symbol') or '').strip()
            if not name: raise ValueError('Master name is required')
            old=str(record.get('old_name') or record.get('old_symbol') or name)
            target=c.setdefault(field,{} if kind in ('ledger','stock_item') else [])
            if old != name and (name in target if isinstance(target,dict) else name in target): raise ValueError('Master name already exists')
            if kind in ('ledger','stock_item'):
                previous=target.get(old,{})
                merged={**previous, **{k:v for k,v in record.items() if k!='old_name'}, 'name':name}
                if kind == 'ledger':
                    parent=merged.get('parent','')
                    if parent not in c['groups']: raise ValueError('Unknown ledger group: '+parent)
                    opening=decimal(merged.get('opening_balance',0),'0.01')
                    signed=merged.get('signed_opening')
                    if 'opening_balance' in record:
                        signed=-abs(opening) if str(merged.get('drcr','Dr')).lower()=='cr' else opening
                    merged['signed_opening']=str(decimal(signed if signed is not None else opening,'0.01'))
                    merged['opening_balance']=str(abs(opening))
                else:
                    qty=record.get('opening_qty',record.get('closing_qty',previous.get('opening_qty',0)))
                    explicit_value=record.get('opening_balance',record.get('closing_balance'))
                    explicit_rate=record.get('opening_rate',record.get('closing_rate'))
                    rate=decimal(explicit_rate if explicit_rate not in (None,'') else previous.get('opening_rate',0))
                    if explicit_value not in (None,''):
                        value=decimal(explicit_value,'0.01')
                        if explicit_rate not in (None,'') and decimal(qty) and value!=decimal(decimal(qty)*rate,'0.01'):
                            raise ValueError('Opening value must equal quantity multiplied by rate')
                    elif any(k in record for k in ('opening_qty','opening_rate','opening_balance','closing_qty','closing_rate')):
                        value=decimal(decimal(qty)*rate,'0.01')
                    else: value=decimal(previous.get('opening_balance',0),'0.01')
                    if decimal(qty)<0 or value<0 or rate<0: raise ValueError('Negative opening stock is not supported')
                    rate=value/decimal(qty) if decimal(qty) else rate
                    merged.update(opening_qty=str(decimal(qty)),opening_balance=str(decimal(value,'0.01')),opening_rate=str(rate))
                    if 'standard_purchase_rate' in record:
                        sp_rate = record.get('standard_purchase_rate')
                        merged['standard_purchase_rate'] = str(decimal(sp_rate, '0.01')) if sp_rate not in (None, '') else ''
                    if 'standard_selling_rate' in record:
                        ss_rate = record.get('standard_selling_rate')
                        merged['standard_selling_rate'] = str(decimal(ss_rate, '0.01')) if ss_rate not in (None, '') else ''
                    if merged.get('base_units') and str(merged['base_units']).strip() in ('Not Applicable', 'None', ''):
                        merged['base_units'] = ''
                    if merged.get('base_units') and merged['base_units'] not in c['units']: raise ValueError('Unknown unit: '+merged['base_units'])
                if old != name and old in target:
                    del target[old]
                    self._rename_references(c,old,name,'LEDGERNAME' if kind=='ledger' else 'STOCKITEMNAME')
                target[name]=merged
                self._rebuild(c)
                return not previous
            records=c.setdefault(kind+'_records',{})
            previous=records.get(old,{})
            if kind=='voucher_type':
                record=dict(record)
                record['base_type']=record.get('base_type') or previous.get('base_type') or (old if old in VOUCHER_TYPES else '')
                if record['base_type'] not in VOUCHER_TYPES: raise ValueError('Select a supported base voucher type')
            if kind=='currency':
                match=next((x for x in target if isinstance(x,dict) and x.get('symbol')==old),None)
                if match: target.remove(match)
                target.append({**previous,**record,'symbol':name})
            else:
                if old in target and old!=name: target[target.index(old)]=name
                elif name not in target: target.append(name)
            records[name]={**previous,**record,'name':name}
            if kind=='group':
                classification=previous.get('system_group') or (old if old in GROUP_PARENTS else record.get('system_group',''))
                if classification and classification not in GROUP_PARENTS: raise ValueError('Invalid system group classification')
                records[name]['system_group']=classification
                parent=record.get('parent',previous.get('parent','Primary'))
                if parent!='Primary' and parent not in c['groups']: raise ValueError('Unknown parent group')
                records[name]['parent']=parent
                if old!=name:
                    for ledger in c['ledgers'].values():
                        if ledger.get('parent')==old: ledger['parent']=name
                    for group in records.values():
                        if group.get('parent')==old: group['parent']=name
                self.root_group(c,name)
            if old!=name:
                records.pop(old,None)
                if kind in ('stock_group','stock_category','cost_centre','godown'):
                    for related in records.values():
                        if related.get('parent')==old: related['parent']=name
                if kind in ('stock_group','stock_category'):
                    for item in c['stock_items'].values():
                        attr='parent' if kind=='stock_group' else 'category'
                        if item.get(attr)==old: item[attr]=name
                if kind=='voucher_type':
                    for voucher in c['vouchers']:
                        if voucher.get('VOUCHERTYPENAME')==old: voucher['VOUCHERTYPENAME']=name
                elif kind in ('unit','godown'):
                    def replace(node):
                        if isinstance(node,dict):
                            for key,value in node.items():
                                if kind=='godown' and key=='GODOWNNAME' and value==old: node[key]=name
                                elif kind=='unit' and key in ('base_units','BASEUNITS') and value==old: node[key]=name
                                elif kind=='unit' and key in ('ACTUALQTY','BILLEDQTY','RATE') and isinstance(value,str):
                                    node[key]=re.sub(r'(?<=[ /])'+re.escape(old)+r'$',lambda _:name,value)
                                elif isinstance(value,(dict,list)): replace(value)
                        elif isinstance(node,list):
                            for value in node: replace(value)
                    replace(c['vouchers']);replace(c['stock_items'])
            self._rebuild(c)
            return not previous

    def bulk_update_item_rates(self, company, items):
        with self.transaction():
            c = self.get_company(company)
            stock_items = c.setdefault('stock_items', {})
            count = 0
            for entry in items:
                name = str(entry.get('name') or '').strip()
                if name and name in stock_items:
                    item = stock_items[name]
                    if 'standard_purchase_rate' in entry:
                        sp = entry.get('standard_purchase_rate')
                        item['standard_purchase_rate'] = str(decimal(sp, '0.01')) if sp not in (None, '') else ''
                    if 'standard_selling_rate' in entry:
                        ss = entry.get('standard_selling_rate')
                        item['standard_selling_rate'] = str(decimal(ss, '0.01')) if ss not in (None, '') else ''
                    count += 1
            self._rebuild(c)
            return count


    def _rename_references(self,c,old,new,key):
        for voucher in c['vouchers']:
            self._assign_bill_ids(voucher)
        def walk(node):
            if isinstance(node,dict):
                for k,value in node.items():
                    if k in (key,'PARTYLEDGERNAME' if key=='LEDGERNAME' else key) and value==old: node[k]=new
                    elif isinstance(value,(dict,list)): walk(value)
            elif isinstance(node,list):
                for value in node: walk(value)
        walk(c['vouchers'])

    def _validate_voucher(self,c,v):
        v['DATE']=date_key(v.get('DATE'))
        if v['DATE'] < (c.get('books_from') or c['starting_from']): raise ValueError('Voucher date precedes company books')
        vtype=v.get('VOUCHERTYPENAME','')
        if vtype not in c['voucher_types']: raise ValueError('Unknown voucher type')
        if v.get('PARTYLEDGERNAME') and v['PARTYLEDGERNAME'] not in c['ledgers']: raise ValueError('Unknown party ledger: '+v['PARTYLEDGERNAME'])
        base=c.get('voucher_type_records',{}).get(vtype,{}).get('base_type',vtype)
        amounts=[]
        for entry in entries(v):
            if entry.get('LEDGERNAME') not in c['ledgers']: raise ValueError('Unknown ledger: '+str(entry.get('LEDGERNAME')))
            amounts.append(entry_debit(entry))
        if base not in NON_ACCOUNTING and effective(v):
            if len(amounts)<2 or not any(amounts): raise ValueError('Enter at least two nonzero ledger entries')
            if sum(amounts,Decimal(0)) != 0: raise ValueError('Debit and credit entries must balance')
        for key in ('ALLINVENTORYENTRIES.LIST','INVENTORYENTRIES.LIST','CONSUMPTIONENTRIES.LIST','PRODUCTIONENTRIES.LIST','PHYSICALSTOCKENTRIES.LIST'):
            for item in entries(v,key):
                if item.get('STOCKITEMNAME') not in c['stock_items']: raise ValueError('Unknown stock item: '+str(item.get('STOCKITEMNAME')))
                decimal(item.get('ACTUALQTY',item.get('BILLEDQTY',0)))

    def post_voucher(self,company,voucher,expected_revision=None,
                     allow_inventory_warning=False, warning_token=None):
        with self.transaction():
            if expected_revision is not None and int(expected_revision) != int(self.data.get('revision', 0)):
                raise ValueError('stale books revision')
            c=self.get_company(company); v=copy.deepcopy(voucher)
            for entry in entries(v):
                name=entry.get('LEDGERNAME')
                if name in ('CGST','SGST','IGST') and name not in c['ledgers']:
                    c['ledgers'][name]={'name':name,'parent':'Duties & Taxes','signed_opening':'0.00',
                        'opening_balance':'0.00','state':c.get('state','')}
            old=None
            if v.get('@ACTION')=='Alter':
                ident=str(v.get('MASTERID') or v.get('GUID') or '')
                old=next((x for x in c['vouchers'] if ident and ident in (str(x.get('MASTERID')),str(x.get('GUID')))),None)
                if old is None: raise ValueError('Voucher to alter was not found; stable identity required')
                v=dict(old,**v)
            if 'BILLING_ROWS' in v:
                billing_rows=self.validate_billing_rows(company, v.get('VOUCHERTYPENAME'),
                    v.get('BILLING_ROWS'), v.get('BILLING_CLIENT_AMOUNTS'))
                inventory_rows=[]
                for key in ('ALLINVENTORYENTRIES.LIST','INVENTORYENTRIES.LIST',
                            'CONSUMPTIONENTRIES.LIST','PRODUCTIONENTRIES.LIST',
                            'PHYSICALSTOCKENTRIES.LIST'):
                    inventory_rows.extend(entries(v,key))
                if len(inventory_rows)!=len(billing_rows):
                    raise ValueError('Billing rows do not match inventory rows')
                for inventory, billing in zip(inventory_rows, billing_rows):
                    inventory['AMOUNT']=billing['amount']
                v['BILLING_ROWS']=billing_rows
                v.pop('BILLING_CLIENT_AMOUNTS',None)
            self._validate_voucher(c,v)
            self._validate_inventory_allocations(c, v)
            self._validate_bill_allocations(c, v, old)
            inventory = self.preview_inventory_posting(company, v)
            if inventory['errors']:
                raise ValueError('Inventory policy blocks this posting')
            if inventory['warnings']:
                expected_token = self.inventory_warning_token(company, v, self.data.get('revision', 0))
                if not allow_inventory_warning or warning_token != expected_token:
                    raise InventoryWarning(inventory['warnings'], expected_token)
            for entry in entries(v): entry['AMOUNT']=str(decimal(entry.get('AMOUNT'),'0.01'))
            number=str(v.get('VOUCHERNUMBER') or self.next_number(c,v['VOUCHERTYPENAME']))
            if any(x is not old and x.get('VOUCHERTYPENAME')==v['VOUCHERTYPENAME'] and str(x.get('VOUCHERNUMBER'))==number for x in c['vouchers']):
                raise ValueError('Voucher number already exists for this type')
            if old:
                v['MASTERID']=old['MASTERID'];v['GUID']=old['GUID']; c['vouchers'][c['vouchers'].index(old)]=v
            else:
                if v.get('GUID') and any(x.get('GUID')==v['GUID'] for x in c['vouchers']): raise ValueError('Voucher GUID already exists')
                if any(x.get('MASTERID')=='v-'+str(c['next_voucher_id']) for x in c['vouchers']): raise ValueError('Voucher identity counter is inconsistent')
                v['MASTERID']='v-'+str(c['next_voucher_id']);c['next_voucher_id']+=1
                v['GUID']=v.get('GUID') or str(uuid.uuid4());c['vouchers'].append(v)
            v['VOUCHERNUMBER']=number
            v['CANCELLED']=v.get('CANCELLED',v.get('ISCANCELLED','No'))
            v.pop('@ACTION',None)
            self._assign_bill_ids(v)
            self._rebuild(c)
            return v['MASTERID']

    def _assign_bill_ids(self, voucher):
        for entry in entries(voucher):
            for allocation in entries(entry, 'BILLALLOCATIONS.LIST'):
                if allocation.get('BILLTYPE', 'New Ref') in ('New Ref', 'Advance'):
                    allocation.setdefault('BILLID', self._bill_id(entry.get('LEDGERNAME', ''),
                        allocation.get('NAME', ''), voucher.get('MASTERID') or voucher.get('GUID') or ''))

    def _validate_bill_allocations(self, company, voucher, old=None):
        """Validate bill splits against the effective books before a post."""
        if not effective(voucher):
            return
        cutoff = date_key(voucher.get('DATE'))
        excluded = old.get('MASTERID') if old else None
        available = [row for row in self._bill_rows(company, cutoff, excluded)
                     if row.get('reference_kind') == 'bill']
        by_id = {row['bill_id']: row for row in available}
        by_name = {}
        for row in available:
            by_name.setdefault((row['ledger'], row['name']), []).append(row)
        requested = {}
        for entry in entries(voucher):
            ledger = str(entry.get('LEDGERNAME') or '')
            if not ledger or not _party_classification(company, ledger):
                continue
            allocations = entries(entry, 'BILLALLOCATIONS.LIST')
            if not allocations:
                continue
            total = abs(entry_debit(entry))
            allocated = Decimal('0.00')
            for allocation in allocations:
                method = str(allocation.get('BILLTYPE') or 'New Ref')
                if method not in ('New Ref', 'Agst Ref', 'Advance', 'On Account'):
                    raise ValueError('Unknown bill allocation method')
                value = abs(decimal(allocation.get('AMOUNT') or entry.get('AMOUNT'), '0.01'))
                allocated += value
                if method != 'Agst Ref':
                    continue
                bill_id = str(allocation.get('BILLID') or '').strip()
                bill = by_id.get(bill_id) if bill_id else None
                if bill is None and not bill_id:
                    matches = by_name.get((ledger, str(allocation.get('NAME') or '').strip()), [])
                    if len(matches) > 1:
                        raise ValueError('ambiguous bill reference')
                    bill = matches[0] if matches else None
                if bill is None:
                    if bill_id and any(row['bill_id'] == bill_id for row in self._bill_rows(company)):
                        raise ValueError('Allocation belongs to another party or bill is unavailable')
                    raise ValueError('Bill reference is future, unknown, or already settled')
                if bill['ledger'] != ledger:
                    raise ValueError('Allocation belongs to another party')
                if decimal(bill['signed_pending']) * entry_debit(entry) >= 0:
                    raise ValueError('Settlement must be on the opposite Dr/Cr side of the bill')
                requested[bill['bill_id']] = requested.get(bill['bill_id'], Decimal('0.00')) + value
                if requested[bill['bill_id']] > decimal(bill['pending'], '0.01'):
                    raise ValueError('Allocation exceeds pending bill amount')
                allocation['BILLID'] = bill['bill_id']
            if allocated > total:
                raise ValueError('Allocation exceeds voucher amount')
            if any(str(item.get('BILLTYPE') or 'New Ref') == 'Agst Ref' for item in allocations) and allocated != total:
                raise ValueError('Allocation sum must equal voucher amount')

    def next_number(self,c,vtype):
        numbers=[int(str(v['VOUCHERNUMBER'])) for v in c['vouchers'] if v.get('VOUCHERTYPENAME')==vtype and str(v.get('VOUCHERNUMBER','')).isdigit()]
        return str(max(numbers,default=0)+1)

    def cancel_or_delete_voucher(self,company,identity,delete=False):
        with self.transaction():
            c=self.get_company(company); ident=str(identity)
            matches=[v for v in c['vouchers'] if ident in (str(v.get('MASTERID')),str(v.get('GUID')))]
            if not matches: matches=[v for v in c['vouchers'] if ident==str(v.get('VOUCHERNUMBER'))]
            if len(matches)>1: raise ValueError('Voucher number is ambiguous; use the stable voucher ID')
            if not matches: return False
            if delete: c['vouchers'].remove(matches[0])
            else: matches[0]['CANCELLED']='Yes'
            self._rebuild(c); return True

    def _rebuild(self,c,to_date=None):
        for l in c['ledgers'].values(): l['signed_closing']=str(decimal(l.get('signed_opening',0),'0.01'))
        for item in c['stock_items'].values():
            item['closing_qty']=item.get('opening_qty',0); item['closing_balance']=item.get('opening_balance',0);item['closing_rate']=item.get('opening_rate',0)
        bills={}
        def _v_sort_key(v):
            mid=str(v.get('MASTERID',''))
            tail=mid.split('-')[-1] if '-' in mid else mid
            return (v.get('DATE',''), int(tail) if tail.isdigit() else 0, mid)
        ordered=sorted(c['vouchers'],key=_v_sort_key)
        for v in ordered:
            if not effective(v) or (to_date and v['DATE']>to_date): continue
            base=c.get('voucher_type_records',{}).get(v['VOUCHERTYPENAME'],{}).get('base_type',v['VOUCHERTYPENAME'])
            if base not in NON_ACCOUNTING:
                for entry in entries(v):
                    ledger=c['ledgers'][entry['LEDGERNAME']]; amount=entry_debit(entry)
                    ledger['signed_closing']=str(decimal(ledger['signed_closing'],'0.01')+amount)
                    for bill in entries(entry,'BILLALLOCATIONS.LIST'):
                        if bill.get('BILLTYPE') in ('On Account','Advance'): continue
                        key=(entry['LEDGERNAME'],bill.get('NAME',''))
                        allocation=abs(decimal(bill.get('AMOUNT'),'0.01'))*(1 if amount>=0 else -1)
                        bills[key]=bills.get(key,Decimal(0))+allocation
            def move(item_record,direction,physical=False):
                item=c['stock_items'][item_record['STOCKITEMNAME']]
                qty=abs(_quantity_in_base(c, item, item_record.get('ACTUALQTY',item_record.get('BILLEDQTY',0))))
                old_qty=decimal(item['closing_qty']);value=decimal(item['closing_balance'],'0.01')
                rate=value/old_qty if old_qty else decimal(item.get('closing_rate',0))
                if physical: item['closing_qty']=str(qty);item['closing_balance']=str((qty*rate).quantize(Decimal('.01'),rounding=ROUND_HALF_UP))
                else:
                    if old_qty+qty*direction<0 and str(c.get('negative_stock_policy', 'warn')).lower() == 'block':
                        raise ValueError('Insufficient stock: '+item_record['STOCKITEMNAME']+' on '+v['DATE'])
                    cost=abs(decimal(item_record.get('AMOUNT'),'0.01')) if direction>0 and base not in ('Credit Note','Rejections In') else (qty*rate).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)
                    item['closing_qty']=str(old_qty+qty*direction);item['closing_balance']=str(value+cost*direction)
                if decimal(item['closing_qty']): item['closing_rate']=str(decimal(item['closing_balance'])/decimal(item['closing_qty']))
            direction=-1 if base in ('Sales','Delivery Note','Debit Note','Rejections Out') else 1 if base in ('Purchase','Receipt Note','Credit Note','Rejections In') else 0
            if direction:
                for row in entries(v,'ALLINVENTORYENTRIES.LIST') or entries(v,'INVENTORYENTRIES.LIST'): move(row,direction)
            if base=='Stock Journal':
                for row in entries(v,'CONSUMPTIONENTRIES.LIST'): move(row,-1)
                for row in entries(v,'PRODUCTIONENTRIES.LIST'): move(row,1)
            if base=='Physical Stock':
                for row in entries(v,'PHYSICALSTOCKENTRIES.LIST') or entries(v,'ALLINVENTORYENTRIES.LIST'): move(row,0,True)
        for l in c['ledgers'].values():
            l['closing_balance']=str(abs(decimal(l['signed_closing']))); l['closing_drcr']='Dr' if decimal(l['signed_closing'])>=0 else 'Cr'
        def party_classification(name):
            l=c['ledgers'].get(name,{})
            group=l.get('parent');seen=set()
            while group and group not in seen:
                seen.add(group);record=c.get('group_records',{}).get(group,{})
                sys_group=record.get('system_group') or group
                if sys_group=='Sundry Debtors': return 'debtor'
                if sys_group=='Sundry Creditors': return 'creditor'
                group=record.get('parent',GROUP_PARENTS.get(group))
            if str(l.get('is_billwise','')).lower()=='yes':
                try:
                    root=self.root_group(c,l.get('parent'))
                    if root in ('Current Assets','Fixed Assets','Investments','Misc. Expenses (ASSET)','Branch / Divisions'): return 'debtor'
                    return 'creditor'
                except Exception: pass
            return None
        c['bills_receivable']=[]
        c['bills_payable']=[]
        for (ledger,name),value in bills.items():
            if not value: continue
            party=party_classification(ledger)
            if party=='debtor':
                c['bills_receivable'].append({'name':name,'ledger':ledger,'closing_balance':str(value)})
            elif party=='creditor':
                c['bills_payable'].append({'name':name,'ledger':ledger,'closing_balance':str(-value)})
            elif value>0:
                c['bills_receivable'].append({'name':name,'ledger':ledger,'closing_balance':str(value)})
            else:
                c['bills_payable'].append({'name':name,'ledger':ledger,'closing_balance':str(-value)})
        # Keep unallocated party balances visible, including opening balances and advances.
        for name,ledger in c['ledgers'].items():
            party=party_classification(name)
            if not party and str(ledger.get('is_billwise','')).lower()!='yes': continue
            remaining=decimal(ledger['signed_closing'])-sum((value for (owner,_),value in bills.items() if owner==name),decimal(0))
            if remaining:
                if party=='debtor' or (not party and remaining>0):
                    c['bills_receivable'].append({'name':'On Account','ledger':name,'closing_balance':str(remaining)})
                else:
                    c['bills_payable'].append({'name':'On Account','ledger':name,'closing_balance':str(-remaining)})
        # Use the same ID-aware replay as the allocation picker and ageing.
        # Preserve legacy non-party report rows produced above.
        for field in ('bills_receivable', 'bills_payable'):
            c[field] = [row for row in c[field] if not _party_classification(c, row['ledger'])]
        for row in self._bill_rows(c, to_date):
            value = decimal(row['signed_pending'])
            field = 'bills_receivable' if row['party'] == 'debtor' else 'bills_payable'
            c[field].append(dict(row, closing_balance=str(value if row['party'] == 'debtor' else -value)))

    @staticmethod
    def _report_period(period):
        if not isinstance(period, dict):
            raise ValueError('Report period is required')
        period_id = str(period.get('id') or '').strip()
        start = date_key(period.get('from'))
        end = date_key(period.get('to'))
        if not period_id or end < start:
            raise ValueError('Invalid report period')
        return {'id': period_id, 'from': start, 'to': end,
                **({'label': str(period['label'])} if period.get('label') else {})}

    @staticmethod
    def _report_parent(company, group):
        if not group:
            return ''
        record = company.get('group_records', {}).get(group, {})
        return str(record.get('parent') or GROUP_PARENTS.get(group) or 'Primary')

    def financial_tree(self, company, report, period, detailed=False):
        period = self._report_period(period)
        if report not in ('Balance Sheet', 'Profit & Loss A/c'):
            raise ValueError('Unsupported financial tree report')
        company_record = self.get_company(company)
        if period['from'] < date_key(company_record['starting_from']) or period['to'] > date_key(company_record['ending_at']):
            raise ValueError('Report period is outside company financial year')
        view = self.view(company, period['from'], period['to'])
        nominal = {'Sales Accounts', 'Purchase Accounts', 'Direct Incomes',
                   'Direct Expenses', 'Indirect Incomes', 'Indirect Expenses'}
        snapshot_company = view['name']
        ledger_values = {}
        ledger_periods = {}
        for name, ledger in view.get('ledgers', {}).items():
            is_nominal = (ledger.get('group_type') or ledger.get('root_group_name') or ledger.get('root_group')) in nominal
            included = is_nominal if report == 'Profit & Loss A/c' else not is_nominal
            if not included:
                continue
            closing = decimal(ledger.get('signed_closing', 0), '0.01')
            opening = decimal(ledger.get('period_opening', 0), '0.01')
            movement = decimal(ledger.get('period_movement', 0), '0.01')
            ledger_values[name] = closing
            ledger_periods[name] = (opening, movement, closing)

        paths = {}
        group_names = set()
        for name in ledger_values:
            current = view['ledgers'][name].get('parent', '')
            seen = set()
            chain = []
            while current and current != 'Primary':
                if current in seen:
                    raise ValueError('Group hierarchy contains a cycle')
                seen.add(current)
                chain.append(current)
                group_names.add(current)
                current = self._report_parent(view, current)
            paths[name] = list(reversed(chain))

        revision = int(self.data.get('revision', 0))
        group_data = {}
        children = {}
        for name, path in paths.items():
            parent = None
            for group in path:
                group_data.setdefault(group, {'name': group, 'parent': parent})
                children.setdefault(parent, []).append(group)
                parent = group
        for group in group_names:
            group_data.setdefault(group, {'name': group, 'parent': self._report_parent(view, group)})

        def node_id(node_type, key):
            raw = '\x1f'.join((snapshot_company, report, node_type, key))
            return 'report-' + hashlib.sha1(raw.encode('utf-8')).hexdigest()[:20]

        ledger_by_group = {}
        for name, path in paths.items():
            ledger_by_group.setdefault(path[-1] if path else None, []).append(name)

        def make_node(node_type, key, parent_id=None, path_key=''):
            nid = node_id(node_type, path_key or key)
            if node_type == 'ledger':
                opening, movement, closing = ledger_periods[key]
                name = key
                children_nodes = []
            else:
                name = key
                children_nodes = []
                for child in sorted(set(children.get(key, []))):
                    children_nodes.append(make_node('group', child, nid, (path_key + '/' + child).strip('/')))
                for ledger_name in sorted(ledger_by_group.get(key, [])):
                    children_nodes.append(make_node('ledger', ledger_name, nid,
                                                    (path_key + '/' + ledger_name).strip('/')))
                opening = sum((Decimal(child['opening']) for child in children_nodes), Decimal('0.00'))
                movement = sum((Decimal(child['movement']) for child in children_nodes), Decimal('0.00'))
                closing = sum((Decimal(child['closing']) for child in children_nodes), Decimal('0.00'))
            leaf_total = sum((Decimal(child['leaf_total']) for child in children_nodes), Decimal('0.00'))
            if node_type == 'ledger':
                leaf_total = abs(closing)
            return {
                'company': snapshot_company, 'report': report, 'period': period,
                'period_id': period['id'], 'revision': revision, 'node_type': node_type, 'node_id': nid,
                'node_key': f'{node_type}:{path_key or key}', 'name': name,
                'parent_id': parent_id, 'opening': _report_decimal(opening),
                'movement': _report_decimal(movement), 'closing': _report_decimal(closing),
                'amount': _report_decimal(movement if report == 'Profit & Loss A/c' else closing),
                'leaf_total': _report_decimal(leaf_total),
                'children': children_nodes,
                'context_token': _report_context_token(snapshot_company, report, period, node_type, nid),
            }

        roots = []
        for group in sorted(group_names):
            parent = group_data.get(group, {}).get('parent') or self._report_parent(view, group)
            if parent not in group_names:
                roots.append(make_node('group', group, None, group))
        rows = []
        def flatten(node):
            rows.append(node)
            for child in node.get('children', []):
                flatten(child)
        for root in roots:
            flatten(root)
        stock_total = sum((decimal(item.get('closing_balance', 0), '0.01')
                           for item in view.get('stock_items', {}).values()), Decimal('0.00'))
        nominal_movement = sum((decimal(ledger.get('period_movement', 0), '0.01')
                                for ledger in view.get('ledgers', {}).values()
                                if (ledger.get('group_type') or ledger.get('root_group_name') or ledger.get('root_group')) in nominal), Decimal('0.00'))
        nominal_closing = sum((decimal(ledger.get('signed_closing', 0), '0.01')
                               for ledger in view.get('ledgers', {}).values()
                               if (ledger.get('group_type') or ledger.get('root_group_name') or ledger.get('root_group')) in nominal), Decimal('0.00'))
        calculated = []
        if report == 'Balance Sheet' and stock_total:
            calculated.append(self._calculated_report_node(snapshot_company, report, period,
                                                           'stock', 'Closing Stock', stock_total, 'Stock Summary', revision))
        if report == 'Balance Sheet' and nominal_movement:
            calculated.append(self._calculated_report_node(snapshot_company, report, period,
                                                           'profit', 'Profit & Loss A/c', nominal_closing, 'Profit & Loss A/c', revision))
        roots.extend(calculated)
        rows.extend(calculated)
        if not detailed:
            def collapse(node):
                node['children'] = []
            for root in roots:
                collapse(root)
            rows = roots[:]
        leaf_total = sum((abs(value) for value in ledger_values.values()), Decimal('0.00')) + abs(stock_total)
        if report == 'Profit & Loss A/c':
            profit = -sum((value[1] for value in ledger_periods.values()), Decimal('0.00'))
            debit = sum((max(value[1], Decimal('0.00')) for value in ledger_periods.values()), Decimal('0.00'))
            credit = sum((max(-value[1], Decimal('0.00')) for value in ledger_periods.values()), Decimal('0.00'))
            if profit > 0:
                debit += profit
            elif profit < 0:
                credit += -profit
            totals = {'leaf_total': _report_decimal(leaf_total), 'profit': _report_decimal(profit),
                      'debit': _report_decimal(debit), 'credit': _report_decimal(credit)}
        else:
            debit = sum((max(value, Decimal('0.00')) for value in ledger_values.values()), Decimal('0.00')) + max(stock_total, Decimal('0.00')) + max(nominal_closing, Decimal('0.00'))
            credit = sum((max(-value, Decimal('0.00')) for value in ledger_values.values()), Decimal('0.00')) + max(-nominal_closing, Decimal('0.00'))
            totals = {'leaf_total': _report_decimal(leaf_total), 'debit': _report_decimal(debit),
                      'credit': _report_decimal(credit)}
        return {'company': snapshot_company, 'report': report, 'period': period,
                'revision': revision, 'detailed': bool(detailed), 'roots': roots,
                'rows': rows, 'totals': totals}

    @staticmethod
    def _calculated_report_node(company, report, period, key, name, amount, drill_name, revision=0):
        node_id = 'report-' + hashlib.sha1('\x1f'.join((company, report, 'calculated', key)).encode('utf-8')).hexdigest()[:20]
        node = {'company': company, 'report': report, 'period': period, 'period_id': period['id'],
                'revision': revision, 'node_type': 'calculated', 'node_id': node_id, 'node_key': 'calculated:' + key,
                'name': name, 'parent_id': None, 'opening': '0.00', 'movement': _report_decimal(amount),
                'closing': _report_decimal(amount), 'amount': _report_decimal(amount), 'leaf_total': _report_decimal(abs(amount)),
                'children': [], 'drill_name': drill_name}
        node['context_token'] = _report_context_token(company, report, period, 'calculated', node_id)
        return node

    @staticmethod
    def report_drill(node):
        context = drill_context(node)
        if node['node_type'] == 'calculated':
            name = node.get('drill_name') or node['name']
        elif node['node_type'] == 'group':
            name = 'Group Summary'
        else:
            name = 'Ledger Monthly Summary'
        return {'name': name, 'company': context['company'], 'period': context['period'],
                'node_type': context['node_type'], 'node_id': context['node_id'],
                **({'group': node['name']} if node['node_type'] == 'group' else {}),
                **({'ledger': node['name']} if node['node_type'] == 'ledger' else {})}

    def compare_periods(self, company, report, periods):
        if not isinstance(periods, list) or not periods:
            raise ValueError('At least one comparison period is required')
        normalized = [self._report_period(period) for period in periods]
        company_record = self.get_company(company)
        fy_start, fy_end = date_key(company_record['starting_from']), date_key(company_record['ending_at'])
        if len({period['id'] for period in normalized}) != len(normalized):
            raise ValueError('Comparison period IDs must be unique')
        ordered_periods = sorted(normalized, key=lambda period: period['from'])
        for index, period in enumerate(ordered_periods):
            if period['from'] < fy_start or period['to'] > fy_end:
                raise ValueError('Comparison period is outside company financial year')
            if index and period['from'] <= ordered_periods[index - 1]['to']:
                raise ValueError('Comparison periods overlap')
        snapshots = [self.financial_tree(company, report, period, detailed=True) for period in normalized]
        columns = [{'id': period['id'], 'label': period.get('label', period['id']),
                    'from': period['from'], 'to': period['to']} for period in normalized]
        by_key = {}
        for snapshot in snapshots:
            for row in snapshot['rows']:
                value = by_key.setdefault(row['node_key'], {
                    'name': row['name'], 'node_type': row['node_type'],
                    'node_key': row['node_key'], 'columns': [
                        {'opening': '0.00', 'movement': '0.00', 'closing': '0.00'}
                        for _ in columns], 'contexts': [],
                })
                index = columns.index(next(column for column in columns if column['id'] == snapshot['period']['id']))
                value['columns'][index] = {key: row[key] for key in ('opening', 'movement', 'closing')}
                value['contexts'].append(row)
        rows = sorted(by_key.values(), key=lambda row: (row['node_type'], row['node_key']))
        return {'company': snapshots[0]['company'], 'report': report,
                'revision': int(self.data.get('revision', 0)), 'columns': columns, 'rows': rows}

    def view(self,company=None,from_date=None,to_date=None):
        with self.lock:
            c=copy.deepcopy(self.get_company(company))
            if not c: return {}
            start=date_key(from_date or c['starting_from']);end=date_key(to_date or c['ending_at'])
            if end<start: raise ValueError('Period end precedes start')
            self._rebuild(c,end)
            prior=copy.deepcopy(c);self._rebuild(prior,(dt.datetime.strptime(start,'%Y%m%d').date()-dt.timedelta(days=1)).strftime('%Y%m%d'))
            for name,l in c['ledgers'].items():
                l['period_opening']=prior['ledgers'][name]['signed_closing']
                l['period_movement']=str(decimal(l['signed_closing'])-decimal(l['period_opening']))
                l['root_group']=self.root_group(c,l['parent'])
                l['root_group_name']=l['root_group']
                l['root_group']=c['group_records'].get(l['root_group'],{}).get('system_group') or l['root_group']
                parent=l['parent'];seen=set()
                while parent not in seen:
                    seen.add(parent);record=c['group_records'].get(parent,{})
                    category=record.get('system_group') or (parent if parent in GROUP_PARENTS else '')
                    if category: l['group_type']=category;break
                    parent=record.get('parent','Primary')
                    if parent=='Primary': l['group_type']=l['root_group'];break
            for name,item in c['stock_items'].items():
                item['period_opening_qty']=prior['stock_items'][name]['closing_qty']
                item['period_opening_value']=prior['stock_items'][name]['closing_balance']
            c['all_vouchers']=c['vouchers'];c['vouchers']=[v for v in c['vouchers'] if start<=v['DATE']<=end]
            c['from_date']=start;c['to_date']=end
            return c

    def get_dashboard_metrics(self, company, date=None):
        with self.lock:
            c = copy.deepcopy(self.get_company(company))
            if not c:
                return {}
            if not date:
                date = str(c.get('current_date_iso', '')).replace('-', '') or dt.date.today().strftime('%Y%m%d')
            else:
                date = date_key(date)

            # 1. Today's Sales: Sales vouchers on `date`
            today_sales_vouchers = [
                vch for vch in c.get('vouchers', [])
                if effective(vch) and vch.get('DATE') == date and vch.get('VOUCHERTYPENAME') == 'Sales'
            ]
            today_sales_count = len(today_sales_vouchers)
            today_sales_amount = Decimal('0.00')
            for vch in today_sales_vouchers:
                tot = sum((entry_debit(e) for e in entries(vch) if entry_debit(e) > 0), Decimal('0.00'))
                today_sales_amount += tot

            # 2. Today's Collections: Receipt vouchers on `date`
            today_receipt_vouchers = [
                vch for vch in c.get('vouchers', [])
                if effective(vch) and vch.get('DATE') == date and vch.get('VOUCHERTYPENAME') == 'Receipt'
            ]
            today_collections = Decimal('0.00')
            for vch in today_receipt_vouchers:
                tot = sum((entry_debit(e) for e in entries(vch) if entry_debit(e) > 0), Decimal('0.00'))
                today_collections += tot

            # 3. Due from Customers (Sundry Debtors) & Due to Suppliers (Sundry Creditors)
            self._rebuild(c, date)
            due_from_customers = Decimal('0.00')
            due_to_suppliers = Decimal('0.00')
            for l_name, l_data in c.get('ledgers', {}).items():
                party_cls = _party_classification(c, l_name)
                bal = decimal(l_data.get('signed_closing', 0), '0.01')
                if party_cls == 'debtor' and bal > 0:
                    due_from_customers += bal
                elif party_cls == 'creditor' and bal < 0:
                    due_to_suppliers += (-bal)

            if due_from_customers < 0:
                due_from_customers = Decimal('0.00')
            if due_to_suppliers < 0:
                due_to_suppliers = Decimal('0.00')

            # 4. This Month's Profit
            dt_obj = dt.datetime.strptime(date, '%Y%m%d').date()
            month_start = dt_obj.replace(day=1).strftime('%Y%m%d')
            import calendar
            _, last_day = calendar.monthrange(dt_obj.year, dt_obj.month)
            month_end = dt_obj.replace(day=last_day).strftime('%Y%m%d')
            month_view = self.view(company, month_start, min(month_end, date))
            nominal = {'Sales Accounts', 'Purchase Accounts', 'Direct Incomes',
                       'Direct Expenses', 'Indirect Incomes', 'Indirect Expenses'}
            nominal_movement = sum((decimal(ledger.get('period_movement', 0), '0.01')
                                    for ledger in month_view.get('ledgers', {}).values()
                                    if (ledger.get('group_type') or ledger.get('root_group_name') or ledger.get('root_group')) in nominal), Decimal('0.00'))
            opening_stock = sum((decimal(item.get('period_opening_value', 0), '0.01')
                                 for item in month_view.get('stock_items', {}).values()), Decimal('0.00'))
            closing_stock = sum((decimal(item.get('closing_balance', 0), '0.01')
                                 for item in month_view.get('stock_items', {}).values()), Decimal('0.00'))
            stock_delta = closing_stock - opening_stock
            month_profit = -nominal_movement + stock_delta

            # 5. Trend data (Week, Month, Year)
            week_days = []
            for i in range(6, -1, -1):
                d = dt_obj - dt.timedelta(days=i)
                d_str = d.strftime('%Y%m%d')
                lbl = d.strftime('%a')
                day_sales = sum((sum((entry_debit(e) for e in entries(vch) if entry_debit(e) > 0), Decimal('0.00'))
                                 for vch in c.get('vouchers', [])
                                 if effective(vch) and vch.get('DATE') == d_str and vch.get('VOUCHERTYPENAME') == 'Sales'), Decimal('0.00'))
                week_days.append({'date': d_str, 'label': lbl, 'amount': str(day_sales.quantize(Decimal('.01')))})

            month_points = []
            for i in range(29, -1, -5):
                d = dt_obj - dt.timedelta(days=i)
                d_str = d.strftime('%Y%m%d')
                lbl = d.strftime('%d %b')
                day_sales = sum((sum((entry_debit(e) for e in entries(vch) if entry_debit(e) > 0), Decimal('0.00'))
                                 for vch in c.get('vouchers', [])
                                 if effective(vch) and vch.get('DATE') == d_str and vch.get('VOUCHERTYPENAME') == 'Sales'), Decimal('0.00'))
                month_points.append({'date': d_str, 'label': lbl, 'amount': str(day_sales.quantize(Decimal('.01')))})

            year_points = []
            fy_start_str = c.get('starting_from', '20260401')
            fy_start_dt = dt.datetime.strptime(fy_start_str, '%Y%m%d').date()
            for m in range(12):
                m_dt = dt.date(fy_start_dt.year + (fy_start_dt.month + m - 1) // 12, (fy_start_dt.month + m - 1) % 12 + 1, 1)
                m_str = m_dt.strftime('%Y%m')
                lbl = m_dt.strftime('%b')
                m_sales = sum((sum((entry_debit(e) for e in entries(vch) if entry_debit(e) > 0), Decimal('0.00'))
                               for vch in c.get('vouchers', [])
                               if effective(vch) and vch.get('DATE', '').startswith(m_str) and vch.get('VOUCHERTYPENAME') == 'Sales'), Decimal('0.00'))
                year_points.append({'month': m_str, 'label': lbl, 'amount': str(m_sales.quantize(Decimal('.01')))})

            return {
                'today_sales': {'amount': str(today_sales_amount.quantize(Decimal('.01'))), 'count': today_sales_count},
                'today_collections': str(today_collections.quantize(Decimal('.01'))),
                'due_from_customers': str(due_from_customers.quantize(Decimal('.01'))),
                'due_to_suppliers': str(due_to_suppliers.quantize(Decimal('.01'))),
                'month_profit': str(month_profit.quantize(Decimal('.01'))),
                'trend': {
                    'week': week_days,
                    'month': month_points,
                    'year': year_points
                }
            }

