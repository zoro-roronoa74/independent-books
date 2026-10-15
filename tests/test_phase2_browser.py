import sys
from pathlib import Path

from playwright.sync_api import expect

sys.path.insert(0, str(Path(__file__).parent))
from test_browser_vouchers import app, select_name, save


def test_billwise_payment_chains_to_multi_bill_popup_and_saves_split(app):
    page, db, _ = app
    company = db.get_active_company_name()
    db.get_company()['ledgers']['Supplier']['is_billwise'] = 'Yes'
    db.post_voucher(company, {
        'VOUCHERTYPENAME': 'Purchase', 'VOUCHERNUMBER': 'BILL-1', 'DATE': '20260401',
        'PARTYLEDGERNAME': 'Supplier', 'ALLLEDGERENTRIES.LIST': [
            {'LEDGERNAME': 'Supplier', 'AMOUNT': '-100.00', 'ISDEEMEDPOSITIVE': 'No',
             'BILLALLOCATIONS.LIST': [{'NAME': 'INV-1', 'BILLTYPE': 'New Ref', 'AMOUNT': '-100.00'}]},
            {'LEDGERNAME': 'Purchase', 'AMOUNT': '100.00', 'ISDEEMEDPOSITIVE': 'Yes'},
        ],
    })
    page.reload()
    page.wait_for_load_state('networkidle')
    page.locator('#screen').focus()
    page.keyboard.press('F5')
    select_name(page, '[name=payment_bank]', 'Bank')
    page.keyboard.press('Enter')
    select_name(page, '[name=party]', 'Supplier')
    page.keyboard.press('Enter')
    page.locator('[name=payment_amount]').fill('75')
    page.locator('[name=payment_amount]').press('Enter')

    expect(page.locator('#dialog-title')).to_have_text('Bill-wise Details')
    expect(page.locator('#dialog-body')).to_contain_text('INV-1')
    page.locator('[data-allocation-amount]').fill('75')
    page.keyboard.press('Control+a')
    expect(page.locator('#overlay')).to_be_hidden()
    save(page)

    saved = db.get_company()['vouchers'][-1]
    party = next(row for row in saved['ALLLEDGERENTRIES.LIST'] if row['LEDGERNAME'] == 'Supplier')
    allocation = party['BILLALLOCATIONS.LIST'][0]
    assert allocation['NAME'] == 'INV-1'
    assert allocation['BILLTYPE'] == 'Agst Ref'
    assert allocation['AMOUNT'] == '-75.00'


def test_tactile_date_amount_and_two_column_master_picker(app):
    page, _, _ = app
    page.locator('#screen').focus()
    page.keyboard.press('F8')
    page.locator('[name=party]').click()
    expect(page.locator('#keys .lookup-create').first).to_have_text('Create Party Ledger')
    expect(page.locator('#keys .lookup-option', has_text='Customer')).to_be_visible()
    page.locator('#voucher-lookup-search').fill('Customer')
    page.keyboard.press('Enter')
    page.locator('[name=date]').fill('2')
    page.locator('[name=date]').press('Enter')
    assert page.locator('[name=date]').input_value().endswith('-02')
    page.reload()
    page.wait_for_load_state('networkidle')
    page.locator('#screen').focus()
    page.keyboard.press('F5')
    select_name(page, '[name=payment_bank]', 'Bank')
    page.keyboard.press('Enter')
    select_name(page, '[name=party]', 'Supplier')
    page.keyboard.press('Enter')
    page.locator('[name=payment_amount]').fill('5k')
    expect(page.locator('#voucher-total')).to_contain_text('5,000.00')
