import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).parent))
from test_browser_vouchers import app
from playwright.sync_api import expect

def test_inplace_substring_search_and_overwrite(app):
    page, db, _ = app
    # Add a specific ledger to test middle substring matching
    db.save_master('Voucher Test', 'ledger', {
        'name': 'Jindal TMT Bar 12MM', 'parent': 'Sundry Debtors',
        'opening_balance': '5000', 'drcr': 'Dr', 'state': 'West Bengal'
    })
    page.reload()
    page.wait_for_load_state('networkidle')
    page.locator('#screen').focus()
    page.keyboard.press('F8')  # Sales voucher
    
    party = page.locator('[name=party]')
    party.click()
    # Type middle-word substring 'bar' or '12'
    party.type('12')
    
    # Floating dropdown should be visible and contain the matched item
    floating = page.locator('.floating-dropdown')
    expect(floating).to_be_visible()
    expect(page.locator('#keys')).to_contain_text('Jindal TMT Bar 12MM')
    
    # Press Enter to select
    party.press('Enter')
    expect(party).to_have_value('Jindal TMT Bar 12MM')
    
    # Focus should advance to next control (e.g. account or reference)
    expect(page.locator('[name=account]')).to_be_focused()
