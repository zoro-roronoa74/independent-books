import sys
from pathlib import Path

from playwright.sync_api import expect

sys.path.insert(0, str(Path(__file__).parent))
from test_browser_vouchers import app, select_name, save


def test_tracked_item_opens_nested_godown_batch_allocation_and_persists(app):
    page, db, _ = app
    db.save_master('Voucher Test', 'godown', {'name': 'North', 'parent': 'Primary'})
    db.get_company()['stock_items']['Steel']['track_allocations'] = 'Yes'
    page.reload()
    page.wait_for_load_state('networkidle')
    page.locator('#screen').focus()
    page.keyboard.press('F8')
    select_name(page, '[name=party]', 'Customer')
    select_name(page, '[name=account]', 'Sales')
    page.locator('[name=item]').click()
    page.locator('#voucher-lookup-search').fill('Steel')
    page.keyboard.press('Enter')

    expect(page.locator('#dialog-title')).to_have_text('Item Allocation — Godown / Batch')
    page.locator('#inventory-allocation-total').fill('2')
    page.locator('[data-inventory-godown]').select_option(label='North')
    page.locator('[data-inventory-batch]').fill('LOT-1')
    page.locator('[data-inventory-expiry]').fill('2026-12-31')
    page.locator('[data-inventory-quantity]').fill('2')
    page.keyboard.press('Control+a')
    expect(page.locator('#overlay')).to_be_hidden()
    page.locator('[name=rate]').fill('100')
    page.locator('[name=rate]').press('Enter')
    page.locator('.inventory-entry').last.locator('[name=item]').press('Enter')
    save(page)

    saved = db.get_company()['vouchers'][-1]
    allocation = saved['ALLINVENTORYENTRIES.LIST'][0]['BATCHALLOCATIONS.LIST'][0]
    assert allocation['GODOWNNAME'] == 'North'
    assert allocation['BATCHNAME'] == 'LOT-1'
    assert allocation['EXPIRYDATE'] == '2026-12-31'
