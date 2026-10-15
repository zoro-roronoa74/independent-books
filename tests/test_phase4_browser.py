import sys
from pathlib import Path

from playwright.sync_api import expect

sys.path.insert(0, str(Path(__file__).parent))
from test_browser_vouchers import app


def seed_reports(db):
    db.save_master('Voucher Test', 'group', {'name': 'Operations', 'parent': 'Current Assets'})
    db.save_master('Voucher Test', 'group', {'name': 'Receivables', 'parent': 'Operations'})
    for name, parent, drcr in [('Customer A', 'Receivables', 'Dr'), ('Customer B', 'Receivables', 'Dr')]:
        db.save_master('Voucher Test', 'ledger', {'name': name, 'parent': parent,
                                                   'opening_balance': '0', 'drcr': drcr})
    db.post_voucher('Voucher Test', {
        'VOUCHERTYPENAME': 'Journal', 'VOUCHERNUMBER': 'R-1', 'DATE': '20260401',
        'ALLLEDGERENTRIES.LIST': [
            {'LEDGERNAME': 'Customer A', 'AMOUNT': '100', 'ISDEEMEDPOSITIVE': 'Yes'},
            {'LEDGERNAME': 'Sales', 'AMOUNT': '100', 'ISDEEMEDPOSITIVE': 'No'},
        ],
    })


def test_financial_report_alt_f1_expands_tree_and_drills_with_period(app):
    page, db, _ = app
    seed_reports(db)
    page.reload()
    page.wait_for_load_state('networkidle')
    page.evaluate("action('report', 'Balance Sheet')")
    expect(page.locator('#title')).to_have_text('Balance Sheet')
    expect(page.locator('#screen')).to_contain_text('Current Assets')
    page.keyboard.press('Alt+F1')
    expect(page.locator('#screen')).to_contain_text('Receivables')
    expect(page.locator('#screen')).to_contain_text('Customer A')
    customer = page.locator('[data-report-node="Customer A"]')
    expect(customer).to_be_visible()
    customer.click()
    expect(page.locator('#title')).to_contain_text('Ledger Monthly Summary')
    expect(page.locator('.report-meta')).to_contain_text('1-Apr-26')


def test_financial_report_comparison_shows_empty_period_as_zero(app):
    page, db, _ = app
    seed_reports(db)
    page.reload()
    page.wait_for_load_state('networkidle')
    page.evaluate("action('comparison', 'Balance Sheet')")
    expect(page.locator('#title')).to_have_text('Balance Sheet Comparison')
    expect(page.locator('#screen')).to_contain_text('April')
    expect(page.locator('#screen')).to_contain_text('0.00')
