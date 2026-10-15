import json
import sys
import threading
import urllib.request
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))

from app_server import make_server
from books import Books


def build_books(tmp_path):
    books = Books(str(tmp_path / 'phase1.sqlite3'))
    books.create_or_alter_company({
        'name': 'Phase 1 Books',
        'starting_from': '20260401',
        'ending_at': '20270331',
    })
    for name, parent, opening, drcr in [
        ('Customer', 'Sundry Debtors', '0', 'Dr'),
        ('Sales', 'Sales Accounts', '0', 'Cr'),
        ('Cash', 'Cash-in-hand', '0', 'Dr'),
        ('Expense', 'Direct Expenses', '0', 'Dr'),
    ]:
        books.save_master('Phase 1 Books', 'ledger', {
            'name': name, 'parent': parent, 'opening_balance': opening, 'drcr': drcr,
        })
    return books


def post(books, number, kind, date, narration, entries):
    return books.post_voucher('Phase 1 Books', {
        'VOUCHERTYPENAME': kind,
        'VOUCHERNUMBER': number,
        'DATE': date,
        'NARRATION': narration,
        'ALLLEDGERENTRIES.LIST': entries,
    })


def entry(name, amount, positive):
    return {
        'LEDGERNAME': name,
        'AMOUNT': amount,
        'ISDEEMEDPOSITIVE': 'Yes' if positive else 'No',
    }


def test_last_narration_filters_company_type_and_current_voucher(tmp_path):
    books = build_books(tmp_path)
    first = post(books, '1', 'Sales', '20260401', 'first sale', [
        entry('Customer', '-100.00', False), entry('Sales', '100.00', True)
    ])
    post(books, '2', 'Payment', '20260402', 'payment text', [
        entry('Cash', '-20.00', False), entry('Expense', '20.00', True)
    ])
    post(books, '3', 'Sales', '20260403', 'latest sale', [
        entry('Customer', '-50.00', False), entry('Sales', '50.00', True)
    ])

    assert books.last_narration('Phase 1 Books', 'Sales') == 'latest sale'
    assert books.last_narration('Phase 1 Books', 'Sales', first) == 'latest sale'
    assert books.last_narration('Phase 1 Books', 'Payment') == 'payment text'


def test_legacy_company_gets_non_destructive_mode_defaults(tmp_path):
    books = build_books(tmp_path)

    defaults = books.voucher_mode_defaults('Phase 1 Books', 'Sales')

    assert defaults == {'mode': 'invoice', 'accounting_mode': 'accounting_invoice'}
    assert 'BOOKSENTRYMODE' not in books.get_company()['vouchers'] if books.get_company()['vouchers'] else True


def test_last_narration_endpoint_is_read_only(tmp_path):
    books = build_books(tmp_path)
    post(books, '1', 'Sales', '20260401', 'endpoint narration', [
        entry('Customer', '-100.00', False), entry('Sales', '100.00', True)
    ])
    books.save()
    revision = books.data['revision']
    server = make_server(0, str(tmp_path / 'phase1.sqlite3'))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        url = (
            f"http://127.0.0.1:{server.server_port}/api/last_narration"
            "?company=Phase%201%20Books&voucher_type=Sales"
        )
        response = json.loads(urllib.request.urlopen(url, timeout=3).read())
        assert response == {'status': 'success', 'narration': 'endpoint narration'}
        assert server.db.data['revision'] == revision
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
