"""Isolated live-server gate for the phased workflow plans."""
import argparse
import json
import uuid
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen


ROOT = Path(__file__).parents[1].resolve()
SCRATCH = ROOT / 'tests' / 'scratch_books.sqlite3'


def request_json(base_url, path, payload=None):
    url = base_url.rstrip('/') + path
    request = Request(url, method='POST' if payload is not None else 'GET')
    if payload is not None:
        body = json.dumps(payload).encode('utf-8')
        request.add_header('Content-Type', 'application/json')
    else:
        body = None
    try:
        with urlopen(request, body, timeout=5) as response:
            return response.status, json.loads(response.read())
    except HTTPError as error:
        return error.code, json.loads(error.read())


def require_scratch_identity(base_url: str, expected_path: Path) -> dict:
    status, body = request_json(base_url, '/api/status')
    expected_root = str(ROOT)
    expected_data = str(expected_path.resolve())
    assert status == 200, body
    assert body.get('independent') is True, body
    assert body.get('application_root') == expected_root, body
    assert body.get('data_path') == expected_data, body
    return body


def write_master(base_url, company, kind, name, parent=None):
    record = {'name': name}
    if parent:
        record['parent'] = parent
    status, body = request_json(base_url, '/api/save_' + kind,
                                {'operation': 'Create', 'company': company, 'record': record})
    assert status == 200 and body.get('status') == 'success', body


def write_record(base_url, company, kind, record):
    status, body = request_json(base_url, '/api/save_' + kind,
                                {'operation': 'Create', 'company': company, 'record': record})
    assert status == 200 and body.get('status') == 'success', body


def seed_test_company(base_url: str, phase: int) -> str:
    company = 'Live Gate P%d %s' % (phase, uuid.uuid4().hex[:10])
    status, body = request_json(base_url, '/api/save_company', {'operation': 'Create', 'company_meta': {
        'name': company, 'starting_from': '20260401', 'ending_at': '20270331',
        'books_from': '20260401', 'state': 'West Bengal', 'gstin': '19AAAAA0000A1Z5',
    }})
    assert status == 200 and body.get('status') == 'success', body
    write_master(base_url, company, 'unit', 'pcs')
    write_master(base_url, company, 'ledger', 'Cash', 'Cash-in-hand')
    write_master(base_url, company, 'ledger', 'Capital', 'Capital Account')
    write_master(base_url, company, 'stock_item', 'Gate Item')
    if phase == 3:
        write_record(base_url, company, 'ledger', {'name': 'Supplier', 'parent': 'Sundry Creditors', 'opening_balance': '0', 'drcr': 'Cr'})
        write_record(base_url, company, 'ledger', {'name': 'Purchase', 'parent': 'Purchase Accounts', 'opening_balance': '0', 'drcr': 'Dr'})
        write_record(base_url, company, 'ledger', {'name': 'Customer', 'parent': 'Sundry Debtors', 'opening_balance': '0', 'drcr': 'Dr'})
        write_record(base_url, company, 'ledger', {'name': 'Sales', 'parent': 'Sales Accounts', 'opening_balance': '0', 'drcr': 'Cr'})
    return company


def verify_phase(base_url: str, phase: int) -> dict:
    company = seed_test_company(base_url, phase)
    company_query = quote(company, safe='')
    before_status, before = request_json(base_url, '/api/data?company=' + company_query)
    assert before_status == 200, before
    voucher = {
        'VOUCHERTYPENAME': 'Journal', 'VOUCHERNUMBER': 'LIVE-%d' % phase,
        'DATE': '20260401', 'NARRATION': 'phase %d live gate' % phase,
        'ALLLEDGERENTRIES.LIST': [
            {'LEDGERNAME': 'Cash', 'AMOUNT': '100.00', 'ISDEEMEDPOSITIVE': 'Yes'},
            {'LEDGERNAME': 'Capital', 'AMOUNT': '100.00', 'ISDEEMEDPOSITIVE': 'No'},
        ],
    }
    status, created = request_json(base_url, '/api/create_voucher',
                                    {'company': company, 'voucher': voucher})
    assert status == 200 and created.get('voucher_id'), created
    voucher_id = created['voucher_id']
    read_status, data = request_json(base_url, '/api/data?company=' + company_query)
    assert read_status == 200, data
    found = next((v for v in data['vouchers'] if v.get('MASTERID') == voucher_id), None)
    assert found is not None, data
    assert sum((100 if e.get('ISDEEMEDPOSITIVE') == 'Yes' else -100)
               for e in found['ALLLEDGERENTRIES.LIST']) == 0
    assert {e['LEDGERNAME'] for e in found['ALLLEDGERENTRIES.LIST']} == {'Cash', 'Capital'}

    revision = data['revision']
    count = len(data['vouchers'])
    invalid = dict(voucher, VOUCHERNUMBER='INVALID-%d' % phase,
                   **{'ALLLEDGERENTRIES.LIST': [
                       {'LEDGERNAME': 'Cash', 'AMOUNT': '99.00', 'ISDEEMEDPOSITIVE': 'Yes'},
                       {'LEDGERNAME': 'Capital', 'AMOUNT': '100.00', 'ISDEEMEDPOSITIVE': 'No'},
                   ]})
    invalid_status, invalid_body = request_json(base_url, '/api/create_voucher',
                                                {'company': company, 'voucher': invalid})
    assert invalid_status == 400 and invalid_body.get('status') == 'error', invalid_body
    after_status, after = request_json(base_url, '/api/data?company=' + company_query)
    assert after_status == 200, after
    assert after['revision'] == revision and len(after['vouchers']) == count, after
    result = {'phase': phase, 'company': company, 'voucher_id': voucher_id,
              'revision': revision, 'voucher_count': count}
    if phase == 2:
        write_record(base_url, company, 'ledger', {
            'name': 'Customer', 'parent': 'Sundry Debtors', 'opening_balance': '0',
            'drcr': 'Dr', 'is_billwise': 'Yes'})
        write_record(base_url, company, 'ledger', {
            'name': 'Sales', 'parent': 'Sales Accounts', 'opening_balance': '0', 'drcr': 'Cr'})
        status, invoice_result = request_json(base_url, '/api/create_voucher', {'company': company, 'voucher': {
            'VOUCHERTYPENAME': 'Sales', 'VOUCHERNUMBER': 'P2-INV-1', 'DATE': '20260402',
            'PARTYLEDGERNAME': 'Customer', 'ALLLEDGERENTRIES.LIST': [
                {'LEDGERNAME': 'Customer', 'AMOUNT': '-100.00', 'ISDEEMEDPOSITIVE': 'Yes',
                 'BILLALLOCATIONS.LIST': [{'NAME': 'P2-INV-1', 'BILLTYPE': 'New Ref', 'AMOUNT': '-100.00'}]},
                {'LEDGERNAME': 'Sales', 'AMOUNT': '100.00', 'ISDEEMEDPOSITIVE': 'No'},
            ],
        }})
        assert status == 200 and invoice_result.get('voucher_id'), invoice_result
        status, pending = request_json(base_url, '/api/pending_bills?company=' + company_query + '&ledger=Customer')
        assert status == 200 and len(pending.get('bills', [])) == 1, pending
        bill = pending['bills'][0]
        status, current = request_json(base_url, '/api/data?company=' + company_query)
        assert status == 200, current
        status, receipt_result = request_json(base_url, '/api/create_voucher', {
            'company': company, 'expected_revision': current['revision'], 'voucher': {
                'VOUCHERTYPENAME': 'Receipt', 'VOUCHERNUMBER': 'P2-REC-1', 'DATE': '20260403',
                'PARTYLEDGERNAME': 'Customer', 'ALLLEDGERENTRIES.LIST': [
                    {'LEDGERNAME': 'Customer', 'AMOUNT': '50.00', 'ISDEEMEDPOSITIVE': 'No',
                     'BILLALLOCATIONS.LIST': [{'NAME': bill['name'], 'BILLID': bill['bill_id'],
                                               'BILLTYPE': 'Agst Ref', 'AMOUNT': '50.00'}]},
                    {'LEDGERNAME': 'Cash', 'AMOUNT': '-50.00', 'ISDEEMEDPOSITIVE': 'Yes'},
                ],
            },
        })
        assert status == 200 and receipt_result.get('voucher_id'), receipt_result
        status, pending_after = request_json(base_url, '/api/pending_bills?company=' + company_query + '&ledger=Customer')
        assert status == 200 and pending_after['bills'][0]['pending'] == '50.00', pending_after
        status, ageing = request_json(base_url, '/api/ageing?company=' + company_query + '&ledger=Customer&as_of=20260430&basis=invoice_date')
        assert status == 200 and len(ageing['report']['buckets']['<30']) == 1, ageing
        result['pending_after_settlement'] = pending_after['bills'][0]['pending']
    if phase == 3:
        purchase = {'VOUCHERTYPENAME': 'Purchase', 'VOUCHERNUMBER': 'P3-REC-1', 'DATE': '20260402',
                    'ALLLEDGERENTRIES.LIST': [
                        {'LEDGERNAME': 'Supplier', 'AMOUNT': '-20.00', 'ISDEEMEDPOSITIVE': 'No'},
                        {'LEDGERNAME': 'Purchase', 'AMOUNT': '20.00', 'ISDEEMEDPOSITIVE': 'Yes'},
                    ], 'ALLINVENTORYENTRIES.LIST': [{
                        'STOCKITEMNAME': 'Gate Item', 'ACTUALQTY': '2', 'BILLEDQTY': '2',
                        'RATE': '10', 'AMOUNT': '20.00',
                        'BATCHALLOCATIONS.LIST': [{'GODOWNNAME': 'Main Location', 'BATCHNAME': 'GATE',
                                                   'ACTUALQTY': '2', 'BILLEDQTY': '2', 'AMOUNT': '20.00'}],
                    }]}
        status, purchase_result = request_json(base_url, '/api/create_voucher', {'company': company, 'voucher': purchase})
        assert status == 200 and purchase_result.get('voucher_id'), purchase_result
        issue = {'VOUCHERTYPENAME': 'Sales', 'VOUCHERNUMBER': 'P3-ISSUE-1', 'DATE': '20260403',
                 'ALLLEDGERENTRIES.LIST': [
                     {'LEDGERNAME': 'Customer', 'AMOUNT': '-30.00', 'ISDEEMEDPOSITIVE': 'Yes'},
                     {'LEDGERNAME': 'Sales', 'AMOUNT': '30.00', 'ISDEEMEDPOSITIVE': 'No'},
                 ], 'ALLINVENTORYENTRIES.LIST': [{'STOCKITEMNAME': 'Gate Item', 'ACTUALQTY': '3',
                                                  'BILLEDQTY': '3', 'RATE': '10', 'AMOUNT': '30.00'}]}
        status, preview = request_json(base_url, '/api/preview_inventory', {'company': company, 'voucher': issue})
        assert status == 200 and preview['inventory']['warnings'][0]['kind'] == 'negative_stock', preview
        status, committed = request_json(base_url, '/api/create_voucher', {
            'company': company, 'voucher': issue, 'expected_revision': preview['revision'],
            'allow_inventory_warning': True, 'warning_token': preview['inventory']['warning_token']})
        assert status == 200 and committed.get('voucher_id'), committed
        result['inventory_warning_commit'] = True
    if phase == 4:
        periods = json.dumps([
            {'id': 'p4-apr', 'label': 'April', 'from': '20260401', 'to': '20260430'},
            {'id': 'p4-may', 'label': 'May', 'from': '20260501', 'to': '20260531'},
        ])
        tree_query = quote(company, safe='')
        status, tree = request_json(base_url, '/api/financial_tree?company=' + tree_query +
                                    '&report=Balance%20Sheet&period_id=p4-apr&from=20260401&to=20260430&detailed=1')
        assert status == 200 and tree['snapshot']['period']['id'] == 'p4-apr', tree
        assert tree['snapshot']['rows'], tree
        status, comparison = request_json(base_url, '/api/compare_periods?company=' + tree_query +
                                          '&report=Balance%20Sheet&periods=' + quote(periods, safe=''))
        assert status == 200 and [column['id'] for column in comparison['comparison']['columns']] == ['p4-apr', 'p4-may'], comparison
        result['report_snapshot'] = True
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=3543)
    parser.add_argument('--phase', type=int, required=True)
    args = parser.parse_args()
    base_url = 'http://127.0.0.1:%d' % args.port
    identity = require_scratch_identity(base_url, SCRATCH)
    result = verify_phase(base_url, args.phase)
    print(json.dumps({'identity': identity, 'verification': result}, sort_keys=True))


if __name__ == '__main__':
    main()
