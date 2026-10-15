"""Browser coverage for contextual voucher lookup and keyboard entry."""
import pytest

pytest.importorskip('playwright.sync_api')
from playwright.sync_api import expect

from test_browser_vouchers import app, invoice_header, item, select_name


def test_voucher_opens_contextual_panel_without_modal(app):
    page, _, _ = app
    page.keyboard.press('F8')
    expect(page.locator('#keys .voucher-lookup-panel')).to_be_visible()
    expect(page.locator('#overlay')).to_be_hidden()
    expect(page.locator('#keys .lookup-title')).to_contain_text('Customers')
    expect(page.locator('#keys .lookup-option')).to_contain_text('Customer')
    expect(page.locator('#keys [data-shortcut="F8"]')).to_be_visible()


def test_voucher_lookup_context_follows_focus_and_excludes_unrelated_ledgers(app):
    page, _, _ = app
    invoice_header(page)
    expect(page.locator('#keys .lookup-title')).to_contain_text('Stock Items')
    expect(page.locator('#keys .lookup-option', has_text='Steel')).to_have_count(1)
    page.locator('[name=party]').focus()
    expect(page.locator('#keys .lookup-title')).to_contain_text('Customers')
    expect(page.locator('#keys .lookup-option')).to_contain_text('Customer')
    expect(page.locator('#keys .lookup-option', has_text='Supplier')).to_have_count(0)


def test_receipt_starts_with_bank_cash_context_and_party_context(app):
    page, _, _ = app
    page.keyboard.press('F6')
    expect(page.locator('[name=payment_bank]')).to_be_focused()
    expect(page.locator('#keys .lookup-title')).to_contain_text('Bank / Cash')
    expect(page.locator('#keys .lookup-option', has_text='Bank')).to_have_count(1)
    expect(page.locator('#keys .lookup-option', has_text='Customer')).to_have_count(0)
    page.locator('[name=party]').focus()
    expect(page.locator('#keys .lookup-title')).to_contain_text('Party Ledgers')
    expect(page.locator('#keys .lookup-option', has_text='Customer')).to_have_count(1)
    expect(page.locator('#keys .lookup-option', has_text='Bank')).to_have_count(0)


def test_voucher_has_no_visible_inline_master_buttons(app):
    page, _, _ = app
    page.keyboard.press('F8')
    expect(page.locator('.inline-ledger')).to_have_count(0)


def test_contextual_create_can_be_activated_with_enter(app):
    page, _, _ = app
    page.keyboard.press('F8')
    page.locator('[name=party]').focus()
    page.locator('.lookup-create').first.focus()
    page.keyboard.press('Enter')
    expect(page.locator('#title')).to_contain_text('Ledger Creation')


def test_enter_on_nonfinal_extra_row_advances_without_posting(app):
    page, db, _ = app
    invoice_header(page)
    item(page, 0, 'Steel', '2', '100')
    page.locator('.inventory-entry').last.locator('[name=item]').press('Enter')
    select_name(page, '#extra-table [name=ledger]', 'Delivery')
    page.locator('#extra-table [name=amount]').fill('20')
    page.locator('[data-action=addLine][data-args=extra]').click()
    page.locator('#extra-table .entry').first.locator('[name=amount]').press('Enter')
    expect(page.locator('#extra-table .entry').nth(1).locator('[name=ledger]')).to_be_focused()
    expect(page.locator('#status')).not_to_have_text('Saved')
    assert db.get_company()['vouchers'] == []


def test_final_extra_amount_enter_saves_instead_of_appending_a_row(app):
    page, db, _ = app
    invoice_header(page)
    item(page, 0, 'Steel', '2', '100')
    page.locator('.inventory-entry').last.locator('[name=item]').press('Enter')
    select_name(page, '#extra-table [name=ledger]', 'Delivery')
    page.locator('#extra-table [name=amount]').fill('20')
    page.locator('#extra-table [name=amount]').press('Enter')
    expect(page.locator('#status')).to_have_text('Saved')
    expect(page.locator('#extra-table .entry')).to_have_count(1)
    assert db.get_company()['vouchers']
