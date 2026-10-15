"""Real browser + temporary SQLite books: never posts to the user's company."""
import sys
import threading
from pathlib import Path

import pytest
playwright_sync = pytest.importorskip('playwright.sync_api')
from playwright.sync_api import sync_playwright, expect

sys.path.insert(0, str(Path(__file__).parents[1]))
from app_server import make_server


@pytest.fixture
def app(tmp_path):
    server = make_server(0, str(tmp_path / 'books.sqlite3'))
    db = server.db
    db.create_or_alter_company({'name': 'Voucher Test', 'starting_from': '20260401',
                               'ending_at': '20270331', 'state': 'West Bengal',
                               'gstin': '19AAAAA0000A1Z5'})
    for name, group, opening, side in [
        ('Bank', 'Bank Accounts', '50000', 'Dr'), ('Cash', 'Cash-in-hand', '5000', 'Dr'),
        ('Supplier', 'Sundry Creditors', '18000', 'Cr'), ('Customer', 'Sundry Debtors', '20000', 'Dr'),
        ('Sales', 'Sales Accounts', '0', 'Cr'), ('Purchase', 'Purchase Accounts', '0', 'Dr'),
        ('Discount', 'Indirect Expenses', '0', 'Dr'), ('Delivery', 'Indirect Incomes', '0', 'Cr'),
        ('Round Off', 'Indirect Incomes', '0', 'Cr'),
    ]:
        db.save_master('Voucher Test', 'ledger', {'name': name, 'parent': group,
            'opening_balance': opening, 'drcr': side, 'state': 'West Bengal'})
    db.save_master('Voucher Test', 'unit', {'name': 'pcs'})
    for name, rate in [('Steel', '18'), ('Other Item', '5'), ('Exempt', '0')]:
        db.save_master('Voucher Test', 'stock_item', {'name': name, 'base_units': 'pcs',
            'opening_qty': '100', 'opening_rate': '50', 'gst_rate': rate})
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='msedge', headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        page.set_default_timeout(8000)
        errors = []
        page.on('pageerror', lambda error: errors.append(f'{error}: {error.stack}'))
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        page.wait_for_load_state('networkidle')
        assert not errors, errors
        yield page, db, server
        assert not errors, errors
        browser.close()
    server.shutdown()
    thread.join(timeout=3)
    server.server_close()


def select_name(page, selector, name):
    page.locator(selector).click()
    if page.locator('#keys .voucher-lookup-panel').count():
        page.locator('#voucher-lookup-search').fill(name)
    else:
        page.locator('#dialog-body .list-search').fill(name)
    page.keyboard.press('Enter')
    expect(page.locator('#overlay')).to_be_hidden()


def save(page):
    page.keyboard.press('Control+a')
    expect(page.locator('#status')).to_have_text('Saved')
    expect(page.locator('#overlay')).to_be_hidden()


def invoice_header(page, kind='Sales'):
    page.keyboard.press('F8' if kind == 'Sales' else 'F9')
    select_name(page, '[name=party]', 'Customer' if kind == 'Sales' else 'Supplier')
    select_name(page, '[name=account]', kind)


def item(page, index, name, qty, rate):
    row = page.locator('.inventory-entry').nth(index)
    row.locator('[name=item]').click()
    if page.locator('#keys .voucher-lookup-panel').count():
        page.locator('#voucher-lookup-search').fill(name)
    else:
        page.locator('#dialog-body .list-search').fill(name)
    page.keyboard.press('Enter')
    row.locator('[name=qty]').fill(qty)
    row.locator('[name=rate]').fill(rate)
    row.locator('[name=rate]').press('Enter')
    # Rate -> amount, then amount -> next item row.
    if page.locator('.inventory-entry').count() == index + 1:
        row.locator('[name=itemamount]').press('Enter')


def postings(voucher):
    return {e['LEDGERNAME']: e['AMOUNT'] for e in voucher['ALLLEDGERENTRIES.LIST']}


def test_payment_lookup_advances_and_posts_balanced_payment(app):
    page, db, _ = app
    page.locator('#screen').focus()
    page.keyboard.press('F5')
    expect(page.locator('[name=payment_bank]')).to_be_focused()
    select_name(page, '[name=payment_bank]', 'Bank')
    expect(page.locator('[name=party]')).to_be_focused()
    select_name(page, '[name=party]', 'Supplier')
    expect(page.locator('[name=payment_amount]')).to_be_focused()
    expect(page.locator('#payment-balance')).to_contain_text('18,000.00 Cr')
    page.locator('[name=payment_amount]').fill('2500')
    save(page)
    voucher = db.get_company()['vouchers'][-1]
    assert postings(voucher) == {'Supplier': '-2500.00', 'Bank': '2500.00'}
    assert db.get_company()['ledgers']['Supplier']['signed_closing'] == '-15500.00'


def test_inline_creation_returns_to_second_ledger_row_and_preserves_draft(app):
    page, db, _ = app
    invoice_header(page)
    item(page, 0, 'Steel', '2', '100')
    page.locator('.inventory-entry').last.locator('[name=item]').press('Enter')
    expect(page.locator('#extra-table [name=ledger]').first).to_be_focused()
    select_name(page, '#extra-table [name=ledger]', 'Delivery')
    page.locator('#extra-table [name=amount]').fill('20')
    page.locator('[data-action=addLine][data-args=extra]').click()
    row = page.locator('#extra-table .entry').nth(1)
    row.locator('[name=ledger]').click()
    page.locator('.lookup-create', has_text='Create Expense Ledger').click()
    expect(page.locator('#title')).to_contain_text('Ledger Creation')
    page.locator('#field-name').fill('Special Charge')
    select_name(page, '#field-parent', 'Indirect Incomes')
    save(page)
    expect(page.locator('#title')).to_contain_text('Voucher Creation')
    expect(page.locator('#extra-table .entry').nth(0).locator('[name=ledger]')).to_have_value('Delivery')
    expect(page.locator('#extra-table .entry').nth(1).locator('[name=ledger]')).to_have_value('Special Charge')
    expect(page.locator('.inventory-entry').first.locator('[name=qty]')).to_have_value('2')
    assert 'Special Charge' in db.get_company()['ledgers']


@pytest.mark.parametrize('kind', ['Sales', 'Purchase'])
def test_mixed_rate_invoice_auto_rows_taxes_and_saved_total(app, kind):
    page, db, _ = app
    invoice_header(page, kind)
    item(page, 0, 'Steel', '2', '100')       # 200 * 18% = 36
    item(page, 1, 'Other Item', '1', '100')  # 100 * 5% = 5
    expect(page.locator('.inventory-entry')).to_have_count(3)
    page.locator('.inventory-entry').last.locator('[name=item]').press('Enter')
    expect(page.locator('#extra-table [name=ledger]').first).to_be_focused()
    expect(page.locator('#tax-preview')).to_contain_text('20.50')
    expect(page.locator('#voucher-total')).to_contain_text('341.00')
    save(page)
    values = postings(db.get_company()['vouchers'][-1])
    assert values == ({'Customer': '-341.00', 'Sales': '300.00', 'CGST': '20.50', 'SGST': '20.50'}
                      if kind == 'Sales' else
                      {'Supplier': '341.00', 'Purchase': '-300.00', 'CGST': '-20.50', 'SGST': '-20.50'})


def test_existing_invoice_tax_is_not_doubled_on_alteration(app):
    page, db, _ = app
    invoice_header(page)
    item(page, 0, 'Steel', '1', '100')
    save(page)
    voucher = db.get_company()['vouchers'][-1]
    page.reload()
    page.wait_for_load_state('networkidle')
    page.evaluate('(id) => action("editVoucher", id)', voucher['MASTERID'])
    page.locator('.inventory-entry').first.locator('[name=qty]').fill('2')
    save(page)
    assert postings(db.get_company()['vouchers'][-1]) == {
        'Customer': '-236.00', 'Sales': '200.00', 'CGST': '18.00', 'SGST': '18.00'}


def test_compact_invoice_uses_alt_quantity_formula_without_exposing_hidden_controls(app):
    page, db, _ = app
    profiles = db.billing_profiles('Voucher Test')
    profiles['Sales']['formula'] = 'alt_qty * rate'
    db.save_billing_profiles('Voucher Test', profiles)
    page.reload()
    page.wait_for_load_state('networkidle')
    invoice_header(page)

    assert page.locator('.voucher-head [name=party]').count() == 1
    assert page.locator('.voucher-head [name=account]').count() == 1
    assert page.locator('select[name=godown]').count() == 0
    assert page.locator('select[name=billtype]').count() == 0
    assert page.locator('[name=party_billtype]').count() == 0
    assert page.locator('[name=bankdate]').count() == 0
    headers = page.locator('.inventory-table thead th').all_text_contents()
    assert headers[:5] == ['Item', 'Quantity', 'Alt Quantity', 'Rate', 'Amount']

    row = page.locator('.inventory-entry').first
    row.locator('[name=item]').click()
    page.locator('#voucher-lookup-search').fill('Steel')
    page.keyboard.press('Enter')
    row.locator('[name=qty]').fill('2')
    row.locator('[name=alt_qty]').fill('3')
    row.locator('[name=rate]').fill('100')
    expect(row.locator('[name=itemamount]')).to_have_value('300.00')
    save(page)

    values = postings(db.get_company()['vouchers'][-1])
    assert values['Sales'] == '300.00'
    assert values['Customer'] == '-354.00'


def test_compact_unchanged_edit_preserves_hidden_tally_fields(app):
    page, db, _ = app
    voucher_id = db.post_voucher('Voucher Test', {
        'VOUCHERTYPENAME': 'Sales', 'VOUCHERNUMBER': 'HIDDEN-1', 'DATE': '20260415',
        'PARTYLEDGERNAME': 'Customer', 'BANKDATE': '20260416',
        'ALLLEDGERENTRIES.LIST': [
            {'LEDGERNAME': 'Customer', 'ISDEEMEDPOSITIVE': 'No', 'AMOUNT': '-236.00',
             'BILLALLOCATIONS.LIST': [{'NAME': 'INV-HIDDEN', 'BILLTYPE': 'New Ref', 'AMOUNT': '-236.00'}]},
            {'LEDGERNAME': 'Sales', 'ISDEEMEDPOSITIVE': 'Yes', 'AMOUNT': '200.00'},
            {'LEDGERNAME': 'CGST', 'ISDEEMEDPOSITIVE': 'Yes', 'AMOUNT': '18.00'},
            {'LEDGERNAME': 'SGST', 'ISDEEMEDPOSITIVE': 'Yes', 'AMOUNT': '18.00'},
        ],
        'ALLINVENTORYENTRIES.LIST': [{
            'STOCKITEMNAME': 'Steel', 'ACTUALQTY': '2 pcs', 'BILLEDQTY': '2 pcs',
            'RATE': '100/pcs', 'AMOUNT': '200.00', 'ISDEEMEDPOSITIVE': 'No',
            'BATCHALLOCATIONS.LIST': [{'GODOWNNAME': 'Main Location', 'ACTUALQTY': '2 pcs',
                                       'BILLEDQTY': '2 pcs', 'AMOUNT': '200.00'}],
        }],
    }, allow_inventory_warning=True, warning_token=db.inventory_warning_token(
        'Voucher Test', {'VOUCHERTYPENAME': 'Sales', 'VOUCHERNUMBER': 'HIDDEN-1', 'DATE': '20260415'}, db.data['revision']))
    page.reload()
    page.wait_for_load_state('networkidle')
    page.evaluate('(id) => action("editVoucher", id)', voucher_id)
    save(page)
    saved = db.get_company()['vouchers'][-1]
    assert saved['BANKDATE'].replace('-', '') == '20260416'
    assert saved['ALLLEDGERENTRIES.LIST'][0]['BILLALLOCATIONS.LIST'][0]['NAME'] == 'INV-HIDDEN'
    assert saved['ALLINVENTORYENTRIES.LIST'][0]['BATCHALLOCATIONS.LIST'][0]['GODOWNNAME'] == 'Main Location'


def test_voucher_ui_cleanup_and_current_date(app):
    page, db, _ = app
    page.locator('#screen').focus()
    page.keyboard.press('F8')
    date_val = page.locator('[name=date]').input_value()
    assert '2026' in date_val or '26' in date_val
    screen_text = page.locator('#screen').inner_text()
    assert 'Additional ledgers' not in screen_text
    assert 'GST rows appear automatically' not in screen_text

