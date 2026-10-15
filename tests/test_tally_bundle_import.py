import copy
from pathlib import Path

import pytest

from books import Books
from interchange import apply_import, parse_tally_bundle


SNAPSHOT = Path(r"C:\Users\Prime Steel\AppData\Local\Temp\omnirush\tally-snapshot")


def _xml(messages):
    return (
        '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>'
        '<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>'
        '<STATICVARIABLES><SVCURRENTCOMPANY>Atomic Co</SVCURRENTCOMPANY>'
        '</STATICVARIABLES></REQUESTDESC><REQUESTDATA>'
        + ''.join(f'<TALLYMESSAGE>{message}</TALLYMESSAGE>' for message in messages)
        + '</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>'
    )


def _basic_bundle(voucher=''):
    return _xml([
        '<GROUP NAME="Sundry Debtors"><PARENT>Current Assets</PARENT></GROUP>',
        '<LEDGER NAME="Customer"><PARENT>Sundry Debtors</PARENT><OPENINGBALANCE>0</OPENINGBALANCE></LEDGER>',
        '<LEDGER NAME="Sales"><PARENT>Sales Accounts</PARENT><OPENINGBALANCE>0</OPENINGBALANCE></LEDGER>',
        '<VOUCHERTYPE NAME="Sales"><PARENT>Sales</PARENT></VOUCHERTYPE>',
        voucher,
    ])


def _valid_voucher(remote_id='remote-1'):
    return (
        f'<VOUCHER REMOTEID="{remote_id}" VCHTYPE="Sales" ACTION="Create">'
        '<DATE>20260402</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>'
        '<VOUCHERNUMBER>1</VOUCHERNUMBER><PARTYLEDGERNAME>Customer</PARTYLEDGERNAME>'
        '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Customer</LEDGERNAME>'
        '<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-100.00</AMOUNT>'
        '</ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST>'
        '<LEDGERNAME>Sales</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>'
        '<AMOUNT>100.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
    )


def test_parse_split_tally_files_collects_messages_and_skips_prompt_only_file():
    if not SNAPSHOT.is_dir():
        pytest.skip('Local snapshot diagnostic is unavailable')
    result = parse_tally_bundle([
        {'name': '100003-list-of-accounts.xml', 'text': (SNAPSHOT / '100003-list-of-accounts.xml').read_text()},
        {'name': '100003-day-book.xml', 'text': (SNAPSHOT / '100003-day-book.xml').read_text()},
        {'name': '100003-all-masters.xml', 'text': (SNAPSHOT / '100003-all-masters.xml').read_text()},
    ])

    assert result['company']['name'] == 'Prime  Steel'
    assert result['messages']
    assert any(message['entity'] == 'LEDGER' for message in result['messages'])
    assert any(message['entity'] == 'VOUCHER' for message in result['messages'])
    assert [item['name'] for item in result['skipped']] == ['100003-all-masters.xml']


def test_apply_import_combines_a_bundle_and_reimport_does_not_duplicate_voucher(tmp_path):
    books = Books(str(tmp_path / 'books.sqlite3'))
    payload = {
        'xmls': [{'name': 'company.xml', 'text': _basic_bundle(_valid_voucher())}],
        'company': 'Atomic Co',
        'starting_from': '20260401',
        'ending_at': '20270331',
    }

    first = apply_import(books, payload)
    second = apply_import(books, payload)

    assert first['vouchers'] == 1
    assert second['updated'] == 1
    assert len(books.get_company('Atomic Co')['vouchers']) == 1


def test_incomplete_real_snapshots_report_missing_stock_and_roll_back(tmp_path):
    if not SNAPSHOT.is_dir():
        pytest.skip('Local snapshot diagnostic is unavailable')
    books = Books(str(tmp_path / 'books.sqlite3'))
    payload = {
        'xmls': [
            {'name': '100003-list-of-accounts.xml', 'text': (SNAPSHOT / '100003-list-of-accounts.xml').read_text()},
            {'name': '100003-day-book.xml', 'text': (SNAPSHOT / '100003-day-book.xml').read_text()},
        ],
        'starting_from': '20260401',
        'ending_at': '20270331',
    }

    before = copy.deepcopy(books.data)
    with pytest.raises(ValueError, match='100003-day-book.xml.*Unknown stock item'):
        apply_import(books, payload)
    assert books.data == before
    books.connection.close()


def test_late_bundle_failure_is_atomic(tmp_path):
    books = Books(str(tmp_path / 'books.sqlite3'))
    before = copy.deepcopy(books.data)
    payload = {
        'xmls': [
            {'name': 'masters.xml', 'text': _basic_bundle()},
            {'name': 'bad-day-book.xml', 'text': _xml(['<VOUCHER VCHTYPE="Sales" ACTION="Create">'
                '<DATE>20260301</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>'
                '<VOUCHERNUMBER>bad</VOUCHERNUMBER></VOUCHER>'])},
        ],
        'company': 'Atomic Co',
        'starting_from': '20260401',
        'ending_at': '20270331',
    }

    with pytest.raises(ValueError, match='bad-day-book.xml.*VOUCHER.*date'):
        apply_import(books, payload)

    assert books.data == before
    books.connection.close()


def test_mixed_companies_and_empty_bundle_are_rejected(books_db):
    with pytest.raises(ValueError, match='different companies'):
        apply_import(books_db, {'xmls': [_basic_bundle(), _basic_bundle().replace('Atomic Co', 'Another Co')]})
    with pytest.raises(ValueError, match='No importable'):
        apply_import(books_db, {'xmls': ['<ENVELOPE><LONGPROMPT>File Path:</LONGPROMPT></ENVELOPE>'],
                                'company': 'Empty', 'starting_from': '20260401', 'ending_at': '20270331'})


def test_complete_bundle_orders_masters_and_retains_namespaced_unknowns(books_db):
    voucher = _valid_voucher().replace('REMOTEID="remote-1"', 'REMOTEID="remote-1" xmlns:U="TallyUDF"')
    voucher = voucher.replace('</VOUCHER>', '<U:MARK>keep me</U:MARK></VOUCHER>')
    payload = {'xmls': [_xml([voucher]), _basic_bundle()], 'starting_from': '20260401', 'ending_at': '20270331'}
    apply_import(books_db, payload)
    saved = books_db.get_company()['vouchers'][0]
    assert saved['{TallyUDF}MARK'] == 'keep me'
    assert saved['GUID'] == 'remote-1'
    assert saved['ALLLEDGERENTRIES.LIST'][0]['AMOUNT'] == '-100.00'
