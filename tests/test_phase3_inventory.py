import copy
import json
import sys
import threading
import urllib.error
import urllib.request
from decimal import Decimal
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))

from app_server import make_server
from books import (Books, convert_quantity, fifo_layers, parse_compound_quantity,
                   value_stock_issue)


def build_books(tmp_path):
    books = Books(str(tmp_path / 'phase3.sqlite3'))
    books.create_or_alter_company({
        'name': 'Phase 3 Books', 'starting_from': '20260401', 'ending_at': '20270331',
        'negative_stock_policy': 'warn',
    })
    for name, parent, drcr in [
        ('Customer', 'Sundry Debtors', 'Dr'), ('Supplier', 'Sundry Creditors', 'Cr'),
        ('Sales', 'Sales Accounts', 'Cr'), ('Purchase', 'Purchase Accounts', 'Dr'),
        ('Cash', 'Cash-in-hand', 'Dr'),
    ]:
        books.save_master('Phase 3 Books', 'ledger', {
            'name': name, 'parent': parent, 'opening_balance': '0', 'drcr': drcr,
        })
    books.save_master('Phase 3 Books', 'unit', {'name': 'Nos', 'type': 'quantity', 'factor': '1'})
    books.save_master('Phase 3 Books', 'unit', {
        'name': 'Box', 'type': 'quantity', 'base_unit': 'Nos', 'factor': '10',
        'decimal_places': '0',
    })
    books.save_master('Phase 3 Books', 'godown', {'name': 'North', 'parent': 'Primary'})
    books.save_master('Phase 3 Books', 'stock_item', {
        'name': 'Steel', 'base_units': 'Nos', 'alternate_unit': 'Box',
        'opening_qty': '0', 'opening_balance': '0', 'valuation_method': 'FIFO',
    })
    return books


def inventory_row(quantity, rate, godown='North', batch='B1', expiry='20261231'):
    base_quantity = Decimal(quantity.split()[0]) * (Decimal('10') if quantity.endswith('Box') else Decimal('1'))
    return {
        'STOCKITEMNAME': 'Steel', 'ACTUALQTY': quantity, 'BILLEDQTY': quantity,
        'RATE': rate + '/Nos', 'AMOUNT': str(base_quantity * Decimal(rate)),
        'BATCHALLOCATIONS.LIST': [{
            'GODOWNNAME': godown, 'BATCHNAME': batch, 'EXPIRYDATE': expiry,
            'ACTUALQTY': quantity, 'BILLEDQTY': quantity,
            'AMOUNT': str(base_quantity * Decimal(rate)),
        }],
    }


def post_purchase(books, number, date, quantity, rate):
    amount = Decimal(quantity.split()[0]) * Decimal(rate)
    return books.post_voucher('Phase 3 Books', {
        'VOUCHERTYPENAME': 'Purchase', 'VOUCHERNUMBER': number, 'DATE': date,
        'PARTYLEDGERNAME': 'Supplier', 'ALLLEDGERENTRIES.LIST': [
            {'LEDGERNAME': 'Supplier', 'AMOUNT': str(-amount), 'ISDEEMEDPOSITIVE': 'No'},
            {'LEDGERNAME': 'Purchase', 'AMOUNT': str(amount), 'ISDEEMEDPOSITIVE': 'Yes'},
        ], 'ALLINVENTORYENTRIES.LIST': [inventory_row(quantity, rate)],
    })


def test_compound_quantity_conversion_and_cycle_validation(tmp_path):
    books = build_books(tmp_path)
    units = books.get_company().get('unit_records', {})
    assert parse_compound_quantity('2 Box', units['Box']) == Decimal('2')
    assert convert_quantity(Decimal('2'), 'Box', 'Nos', units) == Decimal('20')
    assert convert_quantity(Decimal('20'), 'Nos', 'Box', units) == Decimal('2')
    with pytest.raises(ValueError, match='dimension'):
        convert_quantity(Decimal('1'), 'Box', 'Nos', {
            **units, 'Nos': {'name': 'Nos', 'type': 'weight', 'factor': '1'},
        })
    with pytest.raises(ValueError, match='cycle'):
        convert_quantity(Decimal('1'), 'A', 'B', {
            'A': {'name': 'A', 'base_unit': 'B', 'factor': '2', 'type': 'quantity'},
            'B': {'name': 'B', 'base_unit': 'A', 'factor': '3', 'type': 'quantity'},
        })


def test_inventory_allocations_preserve_godown_batch_and_expiry(tmp_path):
    from interchange import apply_import, export_xml
    books = build_books(tmp_path)
    post_purchase(books, '1', '20260401', '2 Box', '10')
    voucher = books.get_company()['vouchers'][-1]
    allocation = voucher['ALLINVENTORYENTRIES.LIST'][0]['BATCHALLOCATIONS.LIST'][0]
    assert allocation['GODOWNNAME'] == 'North'
    assert allocation['BATCHNAME'] == 'B1'
    assert allocation['EXPIRYDATE'] == '20261231'
    assert books.get_company()['stock_items']['Steel']['closing_qty'] == '20'
    restored = Books(':memory:')
    try:
        apply_import(restored, {'xml': export_xml(books.get_company())})
        imported = restored.get_company('Phase 3 Books')['vouchers'][-1]
        assert imported['ALLINVENTORYENTRIES.LIST'][0]['BATCHALLOCATIONS.LIST'][0]['BATCHNAME'] == 'B1'
        assert restored.get_company('Phase 3 Books')['stock_items']['Steel']['closing_qty'] == '20'
    finally:
        restored.connection.close()


def test_fifo_layers_and_shortage_are_deterministic(tmp_path):
    books = build_books(tmp_path)
    post_purchase(books, '1', '20260401', '10 Nos', '10')
    post_purchase(books, '2', '20260402', '5 Nos', '14')
    layers = fifo_layers(books.get_company(), 'Steel', 'North', as_of='20260403')
    assert [(layer['quantity'], layer['rate']) for layer in layers] == [
        ('10.00', '10.00'), ('5.00', '14.00')]
    result = value_stock_issue(layers, Decimal('12'), 'fifo')
    assert result == {'quantity': '12.00', 'value': '128.00', 'shortage': '0.00', 'provisional': False}
    shortage = value_stock_issue(layers, Decimal('20'), 'fifo')
    assert shortage == {'quantity': '20.00', 'value': '240.00', 'shortage': '5.00', 'provisional': True}


def test_negative_stock_policy_preview_warns_or_blocks_without_mutating(tmp_path):
    books = build_books(tmp_path)
    sale = {
        'VOUCHERTYPENAME': 'Sales', 'VOUCHERNUMBER': '1', 'DATE': '20260401',
        'ALLLEDGERENTRIES.LIST': [
            {'LEDGERNAME': 'Customer', 'AMOUNT': '-50.00', 'ISDEEMEDPOSITIVE': 'Yes'},
            {'LEDGERNAME': 'Sales', 'AMOUNT': '50.00', 'ISDEEMEDPOSITIVE': 'No'},
        ], 'ALLINVENTORYENTRIES.LIST': [inventory_row('5 Nos', '10')],
    }
    preview = books.preview_inventory_posting('Phase 3 Books', sale)
    assert preview['warnings'][0]['kind'] == 'negative_stock'
    assert books.get_company()['vouchers'] == []
    books.get_company()['negative_stock_policy'] = 'block'
    blocked = books.preview_inventory_posting('Phase 3 Books', sale)
    assert blocked['errors'][0]['kind'] == 'negative_stock'
    assert books.get_company()['vouchers'] == []


def test_inventory_preview_api_is_read_only_and_block_is_structured(tmp_path):
    books = build_books(tmp_path)
    sale = {
        'VOUCHERTYPENAME': 'Sales', 'VOUCHERNUMBER': 'API-1', 'DATE': '20260401',
        'ALLLEDGERENTRIES.LIST': [
            {'LEDGERNAME': 'Customer', 'AMOUNT': '-50.00', 'ISDEEMEDPOSITIVE': 'Yes'},
            {'LEDGERNAME': 'Sales', 'AMOUNT': '50.00', 'ISDEEMEDPOSITIVE': 'No'},
        ], 'ALLINVENTORYENTRIES.LIST': [inventory_row('5 Nos', '10')],
    }
    books.save()
    server = make_server(0, str(tmp_path / 'phase3.sqlite3'))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = 'http://127.0.0.1:%d' % server.server_port
        before = server.db.data['revision']
        request = urllib.request.Request(base + '/api/preview_inventory', data=json.dumps({
            'company': 'Phase 3 Books', 'voucher': sale,
        }).encode(), method='POST', headers={'Content-Type': 'application/json'})
        preview = json.loads(urllib.request.urlopen(request, timeout=3).read())
        assert preview['inventory']['warnings'][0]['kind'] == 'negative_stock'
        assert server.db.data['revision'] == before
        server.db.get_company()['negative_stock_policy'] = 'block'
        with pytest.raises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request, timeout=3)
        assert error.value.code == 409
        body = json.loads(error.value.read())
        assert body['inventory']['errors'][0]['kind'] == 'negative_stock'
        server.db.get_company()['negative_stock_policy'] = 'warn'
        preview_request = urllib.request.Request(base + '/api/preview_inventory', data=json.dumps({
            'company': 'Phase 3 Books', 'voucher': sale,
        }).encode(), method='POST', headers={'Content-Type': 'application/json'})
        preview = json.loads(urllib.request.urlopen(preview_request, timeout=3).read())
        commit_request = urllib.request.Request(base + '/api/create_voucher', data=json.dumps({
            'company': 'Phase 3 Books', 'voucher': sale,
            'allow_inventory_warning': True,
            'warning_token': preview['inventory']['warning_token'],
            'expected_revision': preview['revision'],
        }).encode(), method='POST', headers={'Content-Type': 'application/json'})
        committed = json.loads(urllib.request.urlopen(commit_request, timeout=3).read())
        assert committed['voucher_id']
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=3)
