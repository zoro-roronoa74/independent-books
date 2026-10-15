import sys
import threading
from pathlib import Path
from decimal import Decimal
import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))
from app_server import make_server
from books import Books, decimal

playwright_sync = pytest.importorskip('playwright.sync_api')
from playwright.sync_api import sync_playwright, expect


def test_standard_rates_persistence_and_bulk_update(tmp_path):
    db = Books(str(tmp_path / 'books.sqlite3'))
    db.create_or_alter_company({'name': 'Rates Co', 'starting_from': '20260401', 'ending_at': '20270331'})
    db.save_master('Rates Co', 'unit', {'name': 'pcs'})
    db.save_master('Rates Co', 'stock_item', {
        'name': 'TMT Bar', 'base_units': 'pcs',
        'standard_purchase_rate': '45.00', 'standard_selling_rate': '55.50'
    })

    company = db.get_company('Rates Co')
    item = company['stock_items']['TMT Bar']
    assert item['standard_purchase_rate'] == '45.00'
    assert item['standard_selling_rate'] == '55.50'

    # Test bulk update
    db.save_master('Rates Co', 'stock_item', {
        'name': 'Angle Iron', 'base_units': 'pcs'
    })
    updated = db.bulk_update_item_rates('Rates Co', [
        {'name': 'TMT Bar', 'standard_purchase_rate': '48.00', 'standard_selling_rate': '60.00'},
        {'name': 'Angle Iron', 'standard_purchase_rate': '35.00', 'standard_selling_rate': '42.00'}
    ])
    assert updated == 2
    company = db.get_company('Rates Co')
    assert company['stock_items']['TMT Bar']['standard_purchase_rate'] == '48.00'
    assert company['stock_items']['TMT Bar']['standard_selling_rate'] == '60.00'
    assert company['stock_items']['Angle Iron']['standard_purchase_rate'] == '35.00'
    assert company['stock_items']['Angle Iron']['standard_selling_rate'] == '42.00'


@pytest.fixture
def rates_app(tmp_path):
    server = make_server(0, str(tmp_path / 'books.sqlite3'))
    db = server.db
    db.create_or_alter_company({'name': 'Rate Test', 'starting_from': '20260401', 'ending_at': '20270331', 'gstin': '19AAAAA0000A1Z5'})
    for name, group, opening, side in [
        ('Customer', 'Sundry Debtors', '10000', 'Dr'),
        ('Supplier', 'Sundry Creditors', '10000', 'Cr'),
        ('Sales', 'Sales Accounts', '0', 'Cr'),
        ('Purchase', 'Purchase Accounts', '0', 'Dr'),
    ]:
        db.save_master('Rate Test', 'ledger', {'name': name, 'parent': group,
            'opening_balance': opening, 'drcr': side, 'state': 'West Bengal'})
    db.save_master('Rate Test', 'unit', {'name': 'pcs'})
    db.save_master('Rate Test', 'stock_item', {
        'name': 'Cement 50KG', 'base_units': 'pcs',
        'opening_qty': '100', 'opening_rate': '300',
        'standard_purchase_rate': '320.00', 'standard_selling_rate': '380.00'
    })

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='msedge', headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        page.set_default_timeout(8000)
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        page.wait_for_load_state('networkidle')
        yield page, db, server
        browser.close()
    server.shutdown()
    thread.join(timeout=3)
    server.server_close()


def test_standard_rates_browser_auto_fill_and_overwrite(rates_app):
    page, db, _ = rates_app
    page.locator('#screen').focus()
    page.keyboard.press('F8')  # Sales voucher

    # Select party and account
    page.locator('[name=party]').click()
    page.locator('#voucher-lookup-search').fill('Customer')
    page.keyboard.press('Enter')
    page.locator('[name=account]').click()
    page.locator('#voucher-lookup-search').fill('Sales')
    page.keyboard.press('Enter')

    # Select Cement item
    row = page.locator('.inventory-entry').first
    row.locator('[name=item]').click()
    page.locator('#voucher-lookup-search').fill('Cement')
    page.keyboard.press('Enter')

    # Selling rate should be auto-populated to 380.00
    expect(row.locator('[name=rate]')).to_have_value('380.00')

    # Enter qty
    row.locator('[name=qty]').fill('10')
    row.locator('[name=qty]').press('Enter')
    expect(row.locator('[name=itemamount]')).to_have_value('3800.00')

    page.keyboard.press('Control+a')
    expect(page.locator('#status')).to_have_text('Saved')
    expect(page.locator('#overlay')).to_be_hidden()

    # Now test Purchase voucher auto-populates standard purchase rate (320.00)
    page.keyboard.press('F9')  # Purchase voucher
    page.locator('[name=party]').click()
    page.locator('#voucher-lookup-search').fill('Supplier')
    page.keyboard.press('Enter')
    page.locator('[name=account]').click()
    page.locator('#voucher-lookup-search').fill('Purchase')
    page.keyboard.press('Enter')

    row_p = page.locator('.inventory-entry').first
    row_p.locator('[name=item]').click()
    page.locator('#voucher-lookup-search').fill('Cement')
    page.keyboard.press('Enter')

    # Purchase rate should be auto-populated to 320.00
    expect(row_p.locator('[name=rate]')).to_have_value('320.00')
