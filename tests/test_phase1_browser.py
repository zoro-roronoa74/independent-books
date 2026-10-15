import sys
from pathlib import Path

import pytest
from playwright.sync_api import expect

sys.path.insert(0, str(Path(__file__).parent))
from test_browser_vouchers import app, select_name, item, save, postings


def entry(name, amount, positive):
    return {'LEDGERNAME': name, 'AMOUNT': amount,
            'ISDEEMEDPOSITIVE': 'Yes' if positive else 'No'}


def post(books, number, kind, date, narration, entries):
    return books.post_voucher(books.get_active_company_name(), {
        'VOUCHERTYPENAME': kind, 'VOUCHERNUMBER': number, 'DATE': date,
        'NARRATION': narration, 'ALLLEDGERENTRIES.LIST': entries,
    })


def open_sales(page):
    page.locator('#screen').focus()
    page.keyboard.press('F8')
    select_name(page, '[name=party]', 'Customer')
    select_name(page, '[name=account]', 'Sales')


def test_ctrl_h_exposes_three_modes_without_dropping_draft(app):
    page, db, _ = app
    open_sales(page)
    item(page, 0, 'Steel', '2', '100')
    expect(page.locator('#overlay')).to_be_hidden()

    page.keyboard.press('Control+h')

    expect(page.locator('#dialog-title')).to_have_text('Change Voucher Mode')
    expect(page.locator('#dialog-body')).to_contain_text('Item Invoice')
    expect(page.locator('#dialog-body')).to_contain_text('Accounting Invoice')
    expect(page.locator('#dialog-body')).to_contain_text('As Voucher')
    page.locator('[data-choice="accounting_invoice"]').click()
    expect(page.locator('#voucher-mode')).to_have_text('Accounting Invoice')
    expect(page.locator('#entry-table')).to_be_visible()
    page.keyboard.press('Control+h')
    page.locator('[data-choice="voucher"]').click()
    expect(page.locator('#voucher-mode')).to_have_text('As Voucher')
    page.keyboard.press('Control+h')
    page.locator('[data-choice="invoice"]').click()
    expect(page.locator('#voucher-mode')).to_have_text('Item Invoice')
    expect(page.locator('[name=party]')).to_have_value('Customer')
    expect(page.locator('.inventory-entry').first.locator('[name=qty]')).to_have_value('2')


def test_alt_c_on_party_opens_inline_ledger_creation(app):
    page, _, _ = app
    open_sales(page)
    page.locator('[name=party]').focus()

    page.keyboard.press('Alt+c')

    expect(page.locator('#title')).to_contain_text('Ledger Creation')


def test_ctrl_r_repeats_last_narration_for_voucher_type(app):
    page, db, _ = app
    post(db, '1', 'Sales', '20260401', 'repeat this narration', [
        entry('Customer', '-100.00', False), entry('Sales', '100.00', True)
    ])
    open_sales(page)
    page.locator('#narration').focus()

    page.keyboard.press('Control+r')

    expect(page.locator('#narration')).to_have_value('repeat this narration')


def test_ctrl_n_calculator_evaluates_and_ctrl_m_returns_focus(app):
    page, _, _ = app
    open_sales(page)
    page.locator('#narration').focus()
    page.keyboard.press('Control+n')

    expect(page.locator('#calculator-pane')).to_be_visible()
    page.locator('#calculator-input').fill('2500*18%')
    page.locator('#calculator-input').press('Enter')
    expect(page.locator('#calculator-result')).to_have_text('450')
    page.keyboard.press('Control+m')
    expect(page.locator('#narration')).to_be_focused()


def test_ctrl_a_accepts_current_voucher_without_confirmation(app):
    page, db, _ = app
    open_sales(page)
    item(page, 0, 'Steel', '1', '100')
    page.locator('.inventory-entry').last.locator('[name=item]').press('Enter')
    page.keyboard.press('Control+a')

    expect(page.locator('#status')).to_have_text('Saved')
    expect(page.locator('#overlay')).to_be_hidden()
    assert len(db.get_company()['vouchers']) == 1


def test_keyboard_boundaries_keep_text_editing_and_function_keys(app):
    page, _, _ = app
    open_sales(page)
    number = page.locator('[name=number]')
    number.fill('123')
    number.press('End')
    number.press('Backspace')
    expect(number).to_have_value('123')
    expect(number).to_be_focused()
    date = page.locator('[name=date]')
    date.focus()
    date.press('Home')
    date.press('Backspace')
    expect(number).to_be_focused()
    expect(date).not_to_have_value('')
    page.keyboard.press('F12')
    expect(page.locator('#dialog-title')).to_have_text('Configuration')
    page.keyboard.press('Escape')
    page.keyboard.press('F3')
    expect(page.locator('#dialog-title')).to_have_text('List of Companies')


def test_calculator_escape_does_not_quit_voucher_and_keeps_history(app):
    page, db, _ = app
    open_sales(page)
    page.locator('#narration').fill('keep this')
    page.keyboard.press('Control+n')
    expression = page.locator('#calculator-input')
    expression.fill('12')
    expression.press('End')
    expression.press('Backspace')
    expect(expression).to_have_value('1')
    expression.press('Enter')
    expression.press('Escape')
    expect(page.locator('#overlay')).to_be_hidden()
    expect(page.locator('#narration')).to_be_focused()
    expect(page.locator('#narration')).to_have_value('keep this')
    page.keyboard.press('Control+n')
    expect(page.locator('#calculator-history')).to_contain_text('1 = 1')
    expression.press('Control+a')
    assert db.get_company()['vouchers'] == []


def test_inline_stock_lookup_returns_to_exact_row_and_escape_unwinds(app):
    page, db, _ = app
    open_sales(page)
    item(page, 0, 'Steel', '2', '100')
    target = page.locator('.inventory-entry').nth(1).locator('[name=item]')
    target.click()
    page.keyboard.press('Alt+c')
    expect(page.locator('#title')).to_contain_text('Stock Item Creation')
    page.keyboard.press('Escape')
    expect(page.locator('#title')).to_contain_text('Voucher Creation')
    expect(page.locator('#keys .lookup-title')).to_have_text('Stock Items')
    page.keyboard.press('Alt+c')
    page.locator('#field-name').fill('New Stock')
    select_name(page, '#field-base_units', 'pcs')
    save(page)
    expect(target).to_have_value('New Stock')
    expect(target).to_be_focused()
    expect(page.locator('.inventory-entry').first.locator('[name=item]')).to_have_value('Steel')
    expect(page.locator('.inventory-entry').first.locator('[name=qty]')).to_have_value('2')
    assert 'New Stock' in db.get_company()['stock_items']
    assert db.get_company()['vouchers'] == []


def test_exempt_item_preview_matches_saved_posting(app):
    page, db, _ = app
    open_sales(page)
    item(page, 0, 'Exempt', '1', '100')
    expect(page.locator('#voucher-total')).to_contain_text('100.00')
    save(page)
    assert postings(db.get_company()['vouchers'][-1]) == {
        'Customer': '-100.00', 'Sales': '100.00'}
