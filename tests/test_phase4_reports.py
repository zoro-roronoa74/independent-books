import copy
import json
import sys
import threading
import urllib.parse
import urllib.request
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))

from app_server import make_server
from books import Books, drill_context


def build_books(tmp_path):
    books = Books(str(tmp_path / 'phase4.sqlite3'))
    books.create_or_alter_company({
        'name': 'Phase 4 Books', 'starting_from': '20260401', 'ending_at': '20270331',
    })
    books.save_master('Phase 4 Books', 'group', {'name': 'Operations', 'parent': 'Current Assets'})
    books.save_master('Phase 4 Books', 'group', {'name': 'Receivables', 'parent': 'Operations'})
    books.save_master('Phase 4 Books', 'group', {'name': 'Admin', 'parent': 'Indirect Expenses'})
    for name, parent, drcr in [
        ('Customer A', 'Receivables', 'Dr'), ('Customer B', 'Receivables', 'Dr'),
        ('Cash', 'Cash-in-hand', 'Dr'), ('Sales', 'Sales Accounts', 'Cr'),
        ('Office', 'Admin', 'Dr'),
    ]:
        books.save_master('Phase 4 Books', 'ledger', {
            'name': name, 'parent': parent, 'opening_balance': '0', 'drcr': drcr,
        })
    return books


def post(books, number, date, rows):
    return books.post_voucher('Phase 4 Books', {
        'VOUCHERTYPENAME': 'Journal', 'VOUCHERNUMBER': number, 'DATE': date,
        'ALLLEDGERENTRIES.LIST': rows,
    })


def entry(name, amount, debit):
    return {'LEDGERNAME': name, 'AMOUNT': amount,
            'ISDEEMEDPOSITIVE': 'Yes' if debit else 'No'}


def test_financial_tree_is_recursive_leaf_safe_and_snapshot_bound(tmp_path):
    books = build_books(tmp_path)
    post(books, '1', '20260401', [entry('Customer A', '100', True), entry('Sales', '100', False)])
    post(books, '2', '20260402', [entry('Customer B', '50', True), entry('Sales', '50', False)])
    snapshot = books.financial_tree('Phase 4 Books', 'Balance Sheet', {
        'id': 'apr-2026', 'from': '20260401', 'to': '20260430',
    }, detailed=True)
    assert snapshot['revision'] == books.data['revision']
    assert snapshot['period'] == {'id': 'apr-2026', 'from': '20260401', 'to': '20260430'}
    receivables = next(row for row in snapshot['rows'] if row['name'] == 'Receivables')
    assert receivables['node_type'] == 'group'
    assert [child['name'] for child in receivables['children']] == ['Customer A', 'Customer B']
    assert receivables['leaf_total'] == '150.00'
    assert snapshot['totals']['leaf_total'] == '150.00'
    assert sum(float(row['amount']) for row in snapshot['rows'] if row['node_type'] == 'ledger') == 150
    assert all(row['company'] == 'Phase 4 Books' and row['period_id'] == 'apr-2026' for row in snapshot['rows'])


def test_financial_tree_detailed_toggle_is_idempotent_and_cycles_are_guarded(tmp_path):
    books = build_books(tmp_path)
    post(books, '1', '20260401', [entry('Customer A', '100', True), entry('Sales', '100', False)])
    compact = books.financial_tree('Phase 4 Books', 'Balance Sheet', {
        'id': 'apr', 'from': '20260401', 'to': '20260430'}, detailed=False)
    detailed = books.financial_tree('Phase 4 Books', 'Balance Sheet', {
        'id': 'apr', 'from': '20260401', 'to': '20260430'}, detailed=True)
    detailed_again = books.financial_tree('Phase 4 Books', 'Balance Sheet', {
        'id': 'apr', 'from': '20260401', 'to': '20260430'}, detailed=True)
    assert all(not row['children'] for row in compact['rows'])
    assert detailed['rows'] == detailed_again['rows']
    books.get_company()['group_records']['Operations']['parent'] = 'Receivables'
    with pytest.raises(ValueError, match='cycle'):
        books.financial_tree('Phase 4 Books', 'Balance Sheet', {
            'id': 'apr', 'from': '20260401', 'to': '20260430'}, detailed=True)


def test_compare_periods_has_independent_opening_movement_closing_and_empty_zero(tmp_path):
    books = build_books(tmp_path)
    post(books, '1', '20260401', [entry('Customer A', '100', True), entry('Sales', '100', False)])
    post(books, '2', '20260502', [entry('Customer A', '50', True), entry('Sales', '50', False)])
    result = books.compare_periods('Phase 4 Books', 'Balance Sheet', [
        {'id': 'q1', 'from': '20260401', 'to': '20260430', 'label': 'April'},
        {'id': 'q2', 'from': '20260501', 'to': '20260531', 'label': 'May'},
        {'id': 'empty', 'from': '20260601', 'to': '20260630', 'label': 'June'},
    ])
    assert result['revision'] == books.data['revision']
    assert [column['id'] for column in result['columns']] == ['q1', 'q2', 'empty']
    customer = next(row for row in result['rows'] if row['name'] == 'Customer A')
    assert customer['columns'][0] == {'opening': '0.00', 'movement': '100.00', 'closing': '100.00'}
    assert customer['columns'][1] == {'opening': '100.00', 'movement': '50.00', 'closing': '150.00'}
    assert customer['columns'][2] == {'opening': '150.00', 'movement': '0.00', 'closing': '150.00'}


def test_drill_context_and_report_api_preserve_company_period_and_node(tmp_path):
    books = build_books(tmp_path)
    post(books, '1', '20260401', [entry('Customer A', '100', True), entry('Sales', '100', False)])
    snapshot = books.financial_tree('Phase 4 Books', 'Balance Sheet', {
        'id': 'apr', 'from': '20260401', 'to': '20260430'}, detailed=True)
    node = next(row for row in snapshot['rows'] if row['name'] == 'Customer A')
    context = drill_context(node)
    assert context == {'company': 'Phase 4 Books', 'report': 'Balance Sheet',
                       'period': {'id': 'apr', 'from': '20260401', 'to': '20260430'},
                       'node_type': 'ledger', 'node_id': node['node_id']}
    with pytest.raises(ValueError, match='context'):
        drill_context({**node, 'company': 'Other Company'})

    books.save()
    server = make_server(0, str(tmp_path / 'phase4.sqlite3'))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        query = urllib.parse.urlencode({'company': 'Phase 4 Books', 'report': 'Balance Sheet',
                                        'period_id': 'apr', 'from': '20260401', 'to': '20260430',
                                        'detailed': '1'})
        response = json.loads(urllib.request.urlopen(
            f'http://127.0.0.1:{server.server_port}/api/financial_tree?{query}', timeout=3).read())
        assert response['snapshot']['period']['id'] == 'apr'
        assert response['snapshot']['rows'][0]['company'] == 'Phase 4 Books'
        compare = json.loads(urllib.request.urlopen(
            f'http://127.0.0.1:{server.server_port}/api/compare_periods?{urllib.parse.urlencode({"company": "Phase 4 Books", "report": "Balance Sheet", "periods": json.dumps([{"id": "apr", "from": "20260401", "to": "20260430"}])})}', timeout=3).read())
        assert compare['comparison']['columns'][0]['id'] == 'apr'
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=3)


def test_report_periods_must_be_unique_nonoverlapping_and_inside_company_year(tmp_path):
    books = build_books(tmp_path)
    with pytest.raises(ValueError, match='company financial year'):
        books.financial_tree('Phase 4 Books', 'Balance Sheet', {
            'id': 'before', 'from': '20260301', 'to': '20260331'}, detailed=False)
    with pytest.raises(ValueError, match='overlap'):
        books.compare_periods('Phase 4 Books', 'Balance Sheet', [
            {'id': 'a', 'from': '20260401', 'to': '20260430'},
            {'id': 'b', 'from': '20260415', 'to': '20260515'},
        ])
    with pytest.raises(ValueError, match='unique'):
        books.compare_periods('Phase 4 Books', 'Balance Sheet', [
            {'id': 'same', 'from': '20260401', 'to': '20260430'},
            {'id': 'same', 'from': '20260501', 'to': '20260531'},
        ])


def test_profit_uses_period_movement_and_renamed_system_groups(tmp_path):
    books = build_books(tmp_path)
    post(books, '1', '20260401', [entry('Customer A', '100', True), entry('Sales', '100', False)])
    post(books, '2', '20260502', [entry('Customer A', '50', True), entry('Sales', '50', False)])
    post(books, '3', '20260503', [entry('Office', '10', True), entry('Cash', '10', False)])
    books.save_master('Phase 4 Books', 'group', {'name': 'Revenue', 'old_name': 'Sales Accounts', 'parent': 'Primary'})
    before = copy.deepcopy(books.data)
    period = {'id': 'may', 'from': '20260501', 'to': '20260531'}
    result = books.financial_tree('Phase 4 Books', 'Profit & Loss A/c', period, True)
    sales = next(row for row in result['rows'] if row['name'] == 'Sales')
    assert sales['amount'] == '-50.00'
    assert sales['closing'] == '-150.00'
    assert result['totals']['profit'] == '40.00'
    assert result['totals']['debit'] == result['totals']['credit'] == '50.00'
    balance = books.financial_tree('Phase 4 Books', 'Balance Sheet', period, True)
    assert not any(row['name'] == 'Revenue' for row in balance['rows'])
    assert balance['totals']['debit'] == balance['totals']['credit'] == '150.00'
    assert books.data == before


def test_calculated_stock_and_profit_drill_to_contributors(tmp_path):
    books = build_books(tmp_path)
    books.save_master('Phase 4 Books', 'stock_item', {
        'name': 'Material', 'opening_qty': '2', 'opening_rate': '10'})
    period = {'id': 'apr', 'from': '20260401', 'to': '20260430'}
    before = copy.deepcopy(books.data)
    tree = books.financial_tree('Phase 4 Books', 'Balance Sheet', period, True)
    stock = next(row for row in tree['rows'] if row['name'] == 'Closing Stock')
    assert stock['amount'] == '20.00' and stock['node_type'] == 'calculated'
    assert books.report_drill(stock)['name'] == 'Stock Summary'
    assert books.report_drill(stock)['period'] == period
    post(books, '1', '20260401', [entry('Customer A', '100', True), entry('Sales', '100', False)])
    tree = books.financial_tree('Phase 4 Books', 'Balance Sheet', period, True)
    profit = next(row for row in tree['rows'] if row['node_key'] == 'calculated:profit')
    assert profit['amount'] == '-100.00'
    assert books.report_drill(profit)['name'] == 'Profit & Loss A/c'
    bad = {**stock, 'node_id': 'missing'}
    with pytest.raises(ValueError, match='context'):
        books.report_drill(bad)
    # The snapshot is detached: editing it never edits the books.
    stock['name'] = 'Changed in caller'
    assert books.get_company()['stock_items']['Material']['name'] == 'Material'


def test_comparison_preserves_column_context_and_single_revision(tmp_path):
    books = build_books(tmp_path)
    periods = [{'id': 'may', 'from': '20260501', 'to': '20260531'},
               {'id': 'apr', 'from': '20260401', 'to': '20260430'}]
    before = copy.deepcopy(books.data)
    comparison = books.compare_periods('Phase 4 Books', 'Balance Sheet', periods)
    customer = next(row for row in comparison['rows'] if row['name'] == 'Customer A')
    assert [node['period']['id'] for node in customer['contexts']] == ['may', 'apr']
    assert [node['revision'] for node in customer['contexts']] == [before['revision']] * 2
    assert books.report_drill(customer['contexts'][1])['period'] == periods[1]
    assert books.data == before
