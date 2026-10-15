import sys
import threading
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))
from app_server import make_server
from billing_rules import parse_billing_formula, evaluate_billing_formula

playwright_sync = pytest.importorskip('playwright.sync_api')
from playwright.sync_api import sync_playwright, expect


def test_billing_formula_multi_eval():
    # Multi formula expressions
    # 1. Custom weight per pc: alt_qty / qty
    assert evaluate_billing_formula('alt_qty / qty', {'alt_qty': '100', 'qty': '10'}) == 10
    # 2. Rate per kg: amount / alt_qty
    assert evaluate_billing_formula('amount / alt_qty', {'amount': '500', 'alt_qty': '25'}) == 20
    # 3. Volumetric conversion: length * width * height / 5000
    formula = 'length * width * height / 5000'
    values = {'length': '50', 'width': '40', 'height': '30'}
    assert evaluate_billing_formula(formula, values) == 12


@pytest.fixture
def f12_app(tmp_path):
    server = make_server(0, str(tmp_path / 'books.sqlite3'))
    db = server.db
    db.create_or_alter_company({'name': 'F12 Co', 'starting_from': '20260401', 'ending_at': '20270331',
                                'state': 'West Bengal', 'gstin': '19AAAAA0000A1Z5'})
    for name, group, opening, side in [
        ('Customer', 'Sundry Debtors', '10000', 'Dr'),
        ('Sales', 'Sales Accounts', '0', 'Cr'),
    ]:
        db.save_master('F12 Co', 'ledger', {'name': name, 'parent': group,
            'opening_balance': opening, 'drcr': side, 'state': 'West Bengal'})
    db.save_master('F12 Co', 'unit', {'name': 'pcs'})
    db.save_master('F12 Co', 'stock_item', {
        'name': 'Bar', 'base_units': 'pcs', 'opening_qty': '100', 'opening_rate': '50'
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


def test_contextual_f12_report_vs_voucher(f12_app):
    page, db, _ = f12_app
    page.locator('#screen').focus()

    # Navigate to Day Book report
    page.keyboard.press('k')  # Hotkey for Day Book
    expect(page.locator('#title')).to_have_text('Day Book')

    # Press F12 on Day Book
    page.keyboard.press('F12')
    expect(page.locator('#dialog-title')).to_have_text('Configuration')
    # Report settings should be shown, NOT billing voucher type
    dialog_text = page.locator('#dialog-body').inner_text()
    assert 'Show Narration' in dialog_text or 'Detailed' in dialog_text
    assert 'Voucher type' not in dialog_text

    # Close dialog
    page.keyboard.press('Escape')
    expect(page.locator('#overlay')).to_be_hidden()

    # Now navigate to Sales Voucher
    page.keyboard.press('Escape')  # Back to Gateway
    page.keyboard.press('F8')      # Sales voucher
    expect(page.locator('#title')).to_contain_text('Voucher Creation')

    # Press F12 on Voucher
    page.keyboard.press('F12')
    expect(page.locator('#dialog-title')).to_have_text('Configuration')
    voucher_dialog_text = page.locator('#dialog-body').inner_text()
    assert 'Voucher type' in voucher_dialog_text or 'Amount formula' in voucher_dialog_text
