import sys
import copy
import json
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))

from app_server import make_server
from books import Books


def build_books(tmp_path):
    books = Books(str(tmp_path / 'phase2.sqlite3'))
    books.create_or_alter_company({
        'name': 'Phase 2 Books', 'starting_from': '20260401', 'ending_at': '20270331',
        'state': 'West Bengal',
    })
    for name, parent, drcr in [
        ('Customer', 'Sundry Debtors', 'Dr'),
        ('Supplier', 'Sundry Creditors', 'Cr'),
        ('Sales', 'Sales Accounts', 'Cr'),
        ('Purchase', 'Purchase Accounts', 'Dr'),
        ('Cash', 'Cash-in-hand', 'Dr'),
    ]:
        books.save_master('Phase 2 Books', 'ledger', {
            'name': name, 'parent': parent, 'opening_balance': '0', 'drcr': drcr,
            'is_billwise': 'Yes' if name in ('Customer', 'Supplier') else 'No',
        })
    return books


def ledger(name, amount, positive, allocation=None):
    value = {'LEDGERNAME': name, 'AMOUNT': amount,
             'ISDEEMEDPOSITIVE': 'Yes' if positive else 'No'}
    if allocation is not None:
        value['BILLALLOCATIONS.LIST'] = [allocation]
    return value


def invoice(books, number, date, name, amount, due=None, party='Customer'):
    kind = 'Sales' if party == 'Customer' else 'Purchase'
    income = 'Sales' if party == 'Customer' else 'Purchase'
    party_positive = party == 'Customer'
    allocation = {'NAME': name, 'BILLTYPE': 'New Ref', 'AMOUNT': '-%0.2f' % amount,
                  'BILLDATE': date}
    if due:
        allocation['DUEDATE'] = due
    return books.post_voucher('Phase 2 Books', {
        'VOUCHERTYPENAME': kind, 'VOUCHERNUMBER': number, 'DATE': date,
        'PARTYLEDGERNAME': party, 'ALLLEDGERENTRIES.LIST': [
            ledger(party, '-%0.2f' % amount, party_positive, allocation),
            ledger(income, '%0.2f' % amount, not party_positive),
        ],
    })


def settle(books, number, date, bill, amount, party='Customer'):
    return books.post_voucher('Phase 2 Books', {
        'VOUCHERTYPENAME': 'Receipt' if party == 'Customer' else 'Payment',
        'VOUCHERNUMBER': number, 'DATE': date, 'PARTYLEDGERNAME': party,
        'ALLLEDGERENTRIES.LIST': [
            ledger(party, '%0.2f' % amount, False, {
                'NAME': bill, 'BILLTYPE': 'Agst Ref', 'AMOUNT': '%0.2f' % amount,
            }),
            ledger('Cash', '-%0.2f' % amount, True),
        ],
    })


def test_pending_bills_have_stable_ids_and_partial_settlement(tmp_path):
    books = build_books(tmp_path)
    first_id = invoice(books, '1', '20260401', 'INV-1', 100, '20260411')
    invoice(books, '2', '20260402', 'INV-2', 200, '20260502')
    settle(books, '3', '20260405', 'INV-1', 50)

    bills = books.pending_bills('Phase 2 Books', 'Customer')

    assert [(bill['name'], bill['original'], bill['pending']) for bill in bills] == [
        ('INV-1', '100.00', '50.00'), ('INV-2', '200.00', '200.00')]
    assert bills[0]['bill_id']
    assert bills[0]['date'] == '20260401'
    assert bills[0]['due_date'] == '20260411'
    assert bills[0]['source_voucher_id'] == first_id


def test_allocation_preview_is_read_only_and_commit_checks_revision(tmp_path):
    books = build_books(tmp_path)
    invoice(books, '1', '20260401', 'INV-1', 100)
    bill = books.pending_bills('Phase 2 Books', 'Customer')[0]
    revision = books.data['revision']

    preview = books.allocate_bill_lines('Phase 2 Books', 'Customer', '75', 'Agst Ref', [
        {'bill_id': bill['bill_id'], 'amount': '75'},
    ], revision, commit=False)
    assert preview['residual'] == '0.00'
    assert books.data['revision'] == revision

    committed = books.allocate_bill_lines('Phase 2 Books', 'Customer', '75', 'Agst Ref', [
        {'bill_id': bill['bill_id'], 'amount': '75'},
    ], revision)
    assert committed['allocations'][0]['bill_id'] == bill['bill_id']
    assert books.data['revision'] == revision + 1
    with pytest.raises(ValueError, match='stale'):
        books.allocate_bill_lines('Phase 2 Books', 'Customer', '1', 'Agst Ref', [
            {'bill_id': bill['bill_id'], 'amount': '1'},
        ], revision)


def test_allocation_rejects_overallocation_and_wrong_party(tmp_path):
    books = build_books(tmp_path)
    invoice(books, '1', '20260401', 'INV-1', 100)
    bill = books.pending_bills('Phase 2 Books', 'Customer')[0]

    with pytest.raises(ValueError, match='exceeds'):
        books.allocate_bill_lines('Phase 2 Books', 'Customer', '101', 'Agst Ref', [
            {'bill_id': bill['bill_id'], 'amount': '101'},
        ], books.data['revision'], commit=False)
    with pytest.raises(ValueError, match='party'):
        books.allocate_bill_lines('Phase 2 Books', 'Supplier', '1', 'Agst Ref', [
            {'bill_id': bill['bill_id'], 'amount': '1'},
        ], books.data['revision'], commit=False)


@pytest.mark.parametrize('basis,expected', [
    ('invoice_date', {'<30': 2, '30-60': 1, '60-90': 2, '>90': 1}),
    ('due_date', {'<30': 1, '30-60': 1, '60-90': 2, '>90': 1}),
])
def test_ageing_uses_explicit_boundaries_and_keeps_undated(tmp_path, basis, expected):
    books = build_books(tmp_path)
    for number, date, due in [
        ('1', '20260621', '20260621'),  # 10 days
        ('2', '20260601', '20260601'),  # 30 days
        ('3', '20260502', '20260502'),  # 60 days
        ('4', '20260402', '20260402'),  # 90 days
        ('5', '20260401', '20260401'),  # 91 days
    ]:
        invoice(books, number, date, 'INV-'+number, 10, due)
    invoice(books, '6', '20260630', 'UNDATED', 10)

    report = books.ageing('Phase 2 Books', 'Customer', '20260701', basis)

    assert {bucket: len(report['buckets'][bucket]) for bucket in expected} == expected
    assert [row['name'] for row in report['undated']] == (['UNDATED'] if basis == 'due_date' else [])


def test_allocation_api_preview_and_commit_preserve_revision_contract(tmp_path):
    books = build_books(tmp_path)
    invoice(books, '1', '20260401', 'INV-1', 100)
    books.save()
    server = make_server(0, str(tmp_path / 'phase2.sqlite3'))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = 'http://127.0.0.1:%d' % server.server_port
        bills = json.loads(urllib.request.urlopen(
            base + '/api/pending_bills?company=Phase%202%20Books&ledger=Customer', timeout=3).read())
        bill = bills['bills'][0]
        revision = server.db.data['revision']
        payload = {'company': 'Phase 2 Books', 'ledger': 'Customer', 'amount': '25',
                   'method': 'Agst Ref', 'allocations': [{'bill_id': bill['bill_id'], 'amount': '25'}],
                   'expected_revision': revision}
        request = urllib.request.Request(base + '/api/preview_allocations',
                                         data=json.dumps(payload).encode(), method='POST',
                                         headers={'Content-Type': 'application/json'})
        preview = json.loads(urllib.request.urlopen(request, timeout=3).read())
        assert preview['allocation']['residual'] == '0.00'
        assert server.db.data['revision'] == revision

        request = urllib.request.Request(base + '/api/allocate_bills',
                                         data=json.dumps(payload).encode(), method='POST',
                                         headers={'Content-Type': 'application/json'})
        committed = json.loads(urllib.request.urlopen(request, timeout=3).read())
        assert committed['allocation']['allocations'][0]['bill_id'] == bill['bill_id']

        stale = urllib.request.Request(base + '/api/allocate_bills',
                                       data=json.dumps(payload).encode(), method='POST',
                                       headers={'Content-Type': 'application/json'})
        with pytest.raises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(stale, timeout=3)
        assert error.value.code == 409
    finally:
        server.shutdown();server.server_close();thread.join(timeout=3)


def receipt(number, allocations, amount='75', date='20260410'):
    party = ledger('Customer', amount, False)
    party['BILLALLOCATIONS.LIST'] = allocations
    return {'VOUCHERTYPENAME': 'Receipt', 'VOUCHERNUMBER': number, 'DATE': date,
            'PARTYLEDGERNAME': 'Customer', 'ALLLEDGERENTRIES.LIST': [
                party, ledger('Cash', '-'+amount, True)]}


def test_voucher_commit_revalidates_splits_and_rolls_back_invalid_writes(tmp_path):
    books = build_books(tmp_path)
    invoice(books, '1', '20260401', 'INV-1', 100)
    bill = books.pending_bills('Phase 2 Books', 'Customer')[0]
    split = {'BILLTYPE': 'Agst Ref', 'BILLID': bill['bill_id'], 'NAME': 'INV-1', 'AMOUNT': '75'}
    before = copy.deepcopy(books.data)
    for voucher, message in [
        (receipt('bad', [split, split], '150'), 'exceeds'),
        (receipt('bad', [split], '100'), 'sum'),
    ]:
        with pytest.raises(ValueError, match=message):
            books.post_voucher('Phase 2 Books', voucher)
        assert books.data == before
    revision = books.data['revision']
    ident = books.post_voucher('Phase 2 Books', receipt('1', [split]), expected_revision=revision)
    assert books.pending_bills('Phase 2 Books', 'Customer')[0]['pending'] == '25.00'
    saved = copy.deepcopy(books.data)
    with pytest.raises(ValueError, match='stale'):
        books.post_voucher('Phase 2 Books', receipt('2', [dict(split, AMOUNT='10')], '10'),
                           expected_revision=revision)
    assert books.data == saved
    voucher = copy.deepcopy(books.get_company()['vouchers'][-1])
    voucher['@ACTION'] = 'Alter'
    books.post_voucher('Phase 2 Books', voucher)
    assert books.pending_bills('Phase 2 Books', 'Customer')[0]['pending'] == '25.00'
    books.cancel_or_delete_voucher('Phase 2 Books', ident)
    assert books.pending_bills('Phase 2 Books', 'Customer')[0]['pending'] == '100.00'


def test_reference_validation_rejects_future_ambiguous_and_duplicate_splits(tmp_path):
    books = build_books(tmp_path)
    invoice(books, '1', '20260501', 'SAME', 100)
    invoice(books, '2', '20260502', 'SAME', 100)
    bill = books.pending_bills('Phase 2 Books', 'Customer')[0]
    revision = books.data['revision']
    with pytest.raises(ValueError, match='exceeds'):
        books.allocate_bill_lines('Phase 2 Books', 'Customer', '150', 'Agst Ref', [
            {'bill_id': bill['bill_id'], 'amount': '75'},
            {'bill_id': bill['bill_id'], 'amount': '75'},
        ], revision, commit=False)
    with pytest.raises(ValueError, match='ambiguous'):
        books.allocate_bill_lines('Phase 2 Books', 'Customer', '10', 'Agst Ref', [
            {'name': 'SAME', 'amount': '10'},
        ], revision, commit=False)
    with pytest.raises(ValueError, match='bill|Bill'):
        books.post_voucher('Phase 2 Books', receipt('1', [
            {'BILLTYPE': 'Agst Ref', 'BILLID': bill['bill_id'], 'NAME': 'SAME', 'AMOUNT': '75'},
        ]))


def test_ageing_all_ledgers_openings_advances_and_explicit_residual(tmp_path):
    books = build_books(tmp_path)
    books.save_master('Phase 2 Books', 'ledger', {
        'name': 'Customer', 'opening_balance': '40', 'drcr': 'Dr'})
    invoice(books, '1', '20260401', 'INV-1', 100, '20260801')
    invoice(books, '2', '20260401', 'SUP-1', 50, party='Supplier')
    books.post_voucher('Phase 2 Books', receipt('1', [
        {'NAME': 'Deposit', 'BILLTYPE': 'Advance', 'AMOUNT': '20',
         'TAXDETAILS': {'CGST': '1.00', 'SGST': '1.00'}, 'CUSTOM': 'retain'},
        {'NAME': 'On Account', 'BILLTYPE': 'On Account', 'AMOUNT': '5'},
    ], '25'))
    report = books.ageing('Phase 2 Books', as_of='20260701', basis='due_date')
    assert {row['ledger'] for row in report['rows']} == {'Customer', 'Supplier'}
    assert [row['name'] for row in report['not_yet_due']] == ['INV-1']
    customer = [row for row in report['rows'] if row['ledger'] == 'Customer']
    assert sum(float(row['signed_pending']) for row in customer) == 115
    advance = next(row for row in customer if row['name'] == 'Deposit')
    assert advance['drcr'] == 'Cr' and advance['pending'] == '20.00'


def test_bill_ids_and_unknown_metadata_survive_xml_and_backup(tmp_path):
    from interchange import apply_import, export_xml
    books = build_books(tmp_path)
    invoice(books, '1', '20260401', 'INV-1', 100)
    bill = books.pending_bills('Phase 2 Books', 'Customer')[0]
    books.post_voucher('Phase 2 Books', receipt('1', [
        {'BILLTYPE': 'Agst Ref', 'BILLID': bill['bill_id'], 'NAME': 'INV-1',
         'AMOUNT': '75', 'CUSTOMMETA': {'SOURCE': 'external'}},
    ]))
    for payload in [{'xml': export_xml(books.get_company())},
                    {'format': 'backup', 'data': copy.deepcopy(books.data)}]:
        restored = Books(':memory:')
        try:
            apply_import(restored, payload)
            remaining = restored.pending_bills('Phase 2 Books', 'Customer')[0]
            assert remaining['bill_id'] == bill['bill_id']
            assert remaining['pending'] == '25.00'
            allocation = restored.get_company()['vouchers'][-1]['ALLLEDGERENTRIES.LIST'][0]['BILLALLOCATIONS.LIST'][0]
            assert allocation['CUSTOMMETA'] == {'SOURCE': 'external'}
        finally:
            restored.connection.close()


def test_creditor_name_only_reference_reduces_bill_and_matches_reports(tmp_path):
    books = build_books(tmp_path)
    invoice(books, '1', '20260401', 'SUP-1', 100, party='Supplier')
    bill = books.pending_bills('Phase 2 Books', 'Supplier')[0]
    payment = {'VOUCHERTYPENAME': 'Payment', 'DATE': '20260402', 'VOUCHERNUMBER': '1',
               'ALLLEDGERENTRIES.LIST': [
                   ledger('Supplier', '-60', True, {'NAME': 'SUP-1', 'BILLTYPE': 'Agst Ref', 'AMOUNT': '-60'}),
                   ledger('Cash', '60', False)]}
    books.post_voucher('Phase 2 Books', payment)
    rows = books.pending_bills('Phase 2 Books', 'Supplier')
    assert [(r['name'], r['pending'], r['drcr']) for r in rows] == [('SUP-1', '40.00', 'Cr')]
    assert books.view()['bills_payable'][0]['bill_id'] == bill['bill_id']


def test_post_rejects_wrong_party_direction_and_split_across_ledger_entries(tmp_path):
    books = build_books(tmp_path)
    invoice(books, '1', '20260401', 'INV-1', 100)
    bill = books.pending_bills('Phase 2 Books', 'Customer')[0]
    allocation = {'NAME': bill['name'], 'BILLID': bill['bill_id'], 'BILLTYPE': 'Agst Ref', 'AMOUNT': '60'}
    before = copy.deepcopy(books.data)
    for voucher in [
        {'VOUCHERTYPENAME': 'Payment', 'DATE': '20260410', 'ALLLEDGERENTRIES.LIST': [
            ledger('Supplier', '-60', True, allocation), ledger('Cash', '60', False)]},
        {'VOUCHERTYPENAME': 'Journal', 'DATE': '20260410', 'ALLLEDGERENTRIES.LIST': [
            ledger('Customer', '-60', True, allocation), ledger('Cash', '60', False)]},
        receipt('1', [allocation], '60'),
    ]:
        if voucher.get('VOUCHERTYPENAME') == 'Receipt':
            voucher['ALLLEDGERENTRIES.LIST'].insert(0, ledger('Customer', '60', False, allocation))
            voucher['ALLLEDGERENTRIES.LIST'][-1]['AMOUNT'] = '-120'
        with pytest.raises(ValueError):
            books.post_voucher('Phase 2 Books', voucher)
        assert books.data == before


def test_legacy_ambiguous_name_is_unallocated_instead_of_first_bill_wins(tmp_path):
    books = build_books(tmp_path)
    invoice(books, '1', '20260401', 'DUP', 100)
    invoice(books, '2', '20260402', 'DUP', 100)
    legacy = receipt('1', [{'NAME': 'DUP', 'BILLTYPE': 'Agst Ref', 'AMOUNT': '75'}])
    legacy.update(MASTERID='v-legacy', GUID='legacy')
    books.get_company()['vouchers'].append(legacy)
    rows = books.pending_bills('Phase 2 Books', 'Customer')
    bills = [row for row in rows if row['reference_kind'] == 'bill']
    assert [row['pending'] for row in bills] == ['100.00', '100.00']
    unresolved = [row for row in rows if row['reference_kind'] == 'unallocated']
    assert len(unresolved) == 1 and unresolved[0]['signed_pending'] == '-75.00'
    assert unresolved[0]['resolution'] == 'ambiguous'


def test_reference_ids_survive_ledger_rename_and_import_into_used_company(tmp_path):
    from interchange import apply_import, export_xml
    books = build_books(tmp_path)
    invoice(books, '1', '20260401', 'INV-1', 100)
    bill_id = books.pending_bills('Phase 2 Books', 'Customer')[0]['bill_id']
    books.save_master('Phase 2 Books', 'ledger', {'name': 'Renamed Customer', 'old_name': 'Customer'})
    assert books.pending_bills('Phase 2 Books', 'Renamed Customer')[0]['bill_id'] == bill_id
    target = build_books(tmp_path / 'other')
    invoice(target, '99', '20260401', 'OTHER', 1)
    try:
        apply_import(target, {'xml': export_xml(books.get_company())})
        imported = target.pending_bills('Phase 2 Books', 'Renamed Customer')[0]
        assert imported['bill_id'] == bill_id
    finally:
        target.connection.close()


def test_allocation_preview_preserves_metadata_and_explicit_residual(tmp_path):
    books = build_books(tmp_path)
    revision = books.data['revision']
    preview = books.allocate_bill_lines('Phase 2 Books', 'Customer', '100', 'New Ref', [
        {'name': 'N-1', 'amount': '60', 'date': '20260401', 'due_date': '20260501', 'custom': 'keep'},
        {'name': 'On Account', 'amount': '40', 'method': 'On Account'},
    ], revision, commit=False)
    assert preview['residual'] == '0.00'
    assert preview['allocations'][0]['custom'] == 'keep'
    assert preview['allocations'][0]['due_date'] == '20260501'
    assert preview['allocations'][1]['method'] == 'On Account'
    before = copy.deepcopy(books.data)
    with pytest.raises(ValueError):
        books.allocate_bill_lines('Phase 2 Books', 'Customer', '100', 'New Ref', [
            {'name': 'N-1', 'amount': '60'},
        ], revision)
    assert books.data == before
