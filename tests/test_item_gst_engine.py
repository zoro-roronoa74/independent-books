import sys
import threading
from pathlib import Path
from decimal import Decimal
import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))
from app_server import make_server
from books import Books, decimal, gst_components, calculate_item_gst

playwright_sync = pytest.importorskip('playwright.sync_api')
from playwright.sync_api import sync_playwright, expect


def test_calculate_item_gst_pure_python():
    company = {
        'gstin': '19AAAAA0000A1Z5',
        'state': 'West Bengal',
        'stock_items': {
            'Steel Rod': {'name': 'Steel Rod', 'gst_rate': '18'},
            'Cement': {'name': 'Cement', 'gst_rate': '28'},
            'Exempt Food': {'name': 'Exempt Food', 'gst_rate': '0'},
        },
        'ledgers': {
            'Local Buyer': {'name': 'Local Buyer', 'state': 'West Bengal'},
            'Outstate Buyer': {'name': 'Outstate Buyer', 'state': 'Maharashtra'},
        }
    }

    # 1. Intra-state 18% item (Rs. 1000) -> 9% CGST (90.00) + 9% SGST (90.00)
    items_local = [
        {'item': 'Steel Rod', 'amount': '1000.00'}
    ]
    taxes = calculate_item_gst(company, 'Local Buyer', items_local)
    assert len(taxes) == 2
    assert taxes[0] == {'ledger': 'CGST', 'amount': '90.00', 'drcr': 'Cr'}
    assert taxes[1] == {'ledger': 'SGST', 'amount': '90.00', 'drcr': 'Cr'}

    # 2. Inter-state 18% item (Rs. 1000) -> 18% IGST (180.00)
    taxes_out = calculate_item_gst(company, 'Outstate Buyer', items_local)
    assert len(taxes_out) == 1
    assert taxes_out[0] == {'ledger': 'IGST', 'amount': '180.00', 'drcr': 'Cr'}

    # 3. 0% item produces no tax
    items_exempt = [
        {'item': 'Exempt Food', 'amount': '500.00'}
    ]
    taxes_exempt = calculate_item_gst(company, 'Local Buyer', items_exempt)
    assert taxes_exempt == []

    # 4. Mixed invoice: 18% (1000.00) + 0% (500.00) -> only 1000.00 taxed
    items_mixed = [
        {'item': 'Steel Rod', 'amount': '1000.00'},
        {'item': 'Exempt Food', 'amount': '500.00'}
    ]
    taxes_mixed = calculate_item_gst(company, 'Local Buyer', items_mixed)
    assert taxes_mixed == [
        {'ledger': 'CGST', 'amount': '90.00', 'drcr': 'Cr'},
        {'ledger': 'SGST', 'amount': '90.00', 'drcr': 'Cr'}
    ]

    # 5. Exact decimal half-up rounding (odd paise: Rs. 100.55 at 18% = 18.099 -> 18.10 -> 9.05 / 9.05)
    odd_items = [{'item': 'Steel Rod', 'amount': '100.55'}]
    odd_taxes = calculate_item_gst(company, 'Local Buyer', odd_items)
    assert odd_taxes == [
        {'ledger': 'CGST', 'amount': '9.05', 'drcr': 'Cr'},
        {'ledger': 'SGST', 'amount': '9.05', 'drcr': 'Cr'}
    ]


@pytest.fixture
def gst_app(tmp_path):
    server = make_server(0, str(tmp_path / 'books.sqlite3'))
    db = server.db
    db.create_or_alter_company({'name': 'GST Co', 'starting_from': '20260401', 'ending_at': '20270331',
                                'state': 'West Bengal', 'gstin': '19AAAAA0000A1Z5'})
    for name, group, opening, side, state in [
        ('Local Customer', 'Sundry Debtors', '10000', 'Dr', 'West Bengal'),
        ('Interstate Customer', 'Sundry Debtors', '10000', 'Dr', 'Delhi'),
        ('Sales', 'Sales Accounts', '0', 'Cr', 'West Bengal'),
    ]:
        db.save_master('GST Co', 'ledger', {'name': name, 'parent': group,
            'opening_balance': opening, 'drcr': side, 'state': state})
    db.save_master('GST Co', 'unit', {'name': 'pcs'})
    db.save_master('GST Co', 'stock_item', {
        'name': 'Widget 18', 'base_units': 'pcs', 'opening_qty': '100', 'opening_rate': '100',
        'gst_rate': '18', 'standard_selling_rate': '100.00'
    })
    db.save_master('GST Co', 'stock_item', {
        'name': 'Exempt Widget', 'base_units': 'pcs', 'opening_qty': '100', 'opening_rate': '50',
        'gst_rate': '0', 'standard_selling_rate': '50.00'
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


def test_interstate_and_intrastate_gst_in_browser(gst_app):
    page, db, _ = gst_app
    page.locator('#screen').focus()
    page.keyboard.press('F8')  # Sales voucher

    # Test Interstate Customer (Delhi vs Company WB) -> IGST 18%
    page.locator('[name=party]').click()
    page.locator('#voucher-lookup-search').fill('Interstate Customer')
    page.keyboard.press('Enter')
    page.locator('[name=account]').click()
    page.locator('#voucher-lookup-search').fill('Sales')
    page.keyboard.press('Enter')

    row = page.locator('.inventory-entry').first
    row.locator('[name=item]').click()
    page.locator('#voucher-lookup-search').fill('Widget 18')
    page.keyboard.press('Enter')

    row.locator('[name=qty]').fill('2')  # 2 * 100 = 200, 18% = 36.00
    row.locator('[name=qty]').press('Enter')

    # Verify IGST row in tax preview
    expect(page.locator('#tax-preview')).to_contain_text('IGST')
    expect(page.locator('#tax-preview')).to_contain_text('36.00')
    expect(page.locator('#voucher-total')).to_contain_text('236.00')

    page.keyboard.press('Control+a')
    expect(page.locator('#status')).to_have_text('Saved')
    expect(page.locator('#overlay')).to_be_hidden()

    # Verify saved voucher ledger entries has IGST
    voucher = db.get_company('GST Co')['vouchers'][-1]
    postings = {e['LEDGERNAME']: e['AMOUNT'] for e in voucher['ALLLEDGERENTRIES.LIST']}
    assert 'IGST' in postings
    assert postings['IGST'] == '36.00'
    assert 'CGST' not in postings
    assert 'SGST' not in postings
