import re
import pytest

playwright_sync = pytest.importorskip('playwright.sync_api')
from playwright.sync_api import expect
from test_browser_vouchers import app


def test_narration_enter_accepts_and_shift_enter_multiline(app):
    page, db, server = app
    page.locator('#screen').focus()
    page.keyboard.press('F8')
    page.wait_for_selector('#edit-form')

    # Fill minimal valid voucher fields
    page.locator('#edit-form [name=party]').select_option('Customer')
    page.locator('#edit-form [name=account]').select_option('Sales')
    page.locator('#edit-form [name=item]').select_option('Steel')
    page.locator('#edit-form [name=qty]').fill('1')
    page.locator('#edit-form [name=rate]').fill('100')

    narration = page.locator('#narration')
    narration.focus()
    narration.fill('First line')
    # Shift+Enter should create a newline without opening accept dialog
    narration.press('Shift+Enter')
    narration.type('Second line')
    expect(narration).to_have_value("First line\nSecond line")
    expect(page.locator('#dialog')).not_to_be_visible()

    # Enter alone in narration should trigger Accept
    narration.press('Enter')
    expect(page.locator('#dialog')).to_be_visible()
    expect(page.locator('#dialog-title')).to_contain_text('Accept')
    page.keyboard.press('Escape')


def test_additional_charges_in_print_model_and_preview(app):
    page, db, server = app
    result = page.evaluate("""() => {
      const voucher = {
        VOUCHERTYPENAME: 'Sales', VOUCHERNUMBER: 'INV-101', DATE: '20261015',
        PARTYLEDGERNAME: 'Customer', NARRATION: 'With delivery charge',
        'ALLINVENTORYENTRIES.LIST': [{
          STOCKITEMNAME: 'Steel', ACTUALQTY: '1 pcs', RATE: '100/pcs', AMOUNT: '100.00'
        }],
        'ALLLEDGERENTRIES.LIST': [
          {LEDGERNAME: 'Customer', AMOUNT: '-110.00', ISDEEMEDPOSITIVE: 'No'},
          {LEDGERNAME: 'Sales', AMOUNT: '100.00', ISDEEMEDPOSITIVE: 'Yes'},
          {LEDGERNAME: 'delivery', AMOUNT: '10.00', ISDEEMEDPOSITIVE: 'Yes'},
        ]
      };
      const model = window.IndependentPrintView.buildVoucherPrintModel(voucher, {name: 'Steel Works Ltd'}, null);
      const html = window.IndependentPrintView.renderVoucherPrint(model);
      return {
        total: model.total_amount,
        words: model.amount_in_words,
        extraCount: model.additional_ledgers.length,
        extraName: model.additional_ledgers[0].ledger,
        extraAmt: model.additional_ledgers[0].amount,
        htmlHasDelivery: html.includes('delivery'),
        htmlHas110: html.includes('110.00'),
        htmlHasWords: html.includes('INR One Hundred Ten Only')
      };
    }""")
    assert result['total'] == '110.00'
    assert result['words'] == 'INR One Hundred Ten Only'
    assert result['extraCount'] == 1
    assert result['extraName'] == 'delivery'
    assert result['extraAmt'] == '10.00'
    assert result['htmlHasDelivery'] is True
    assert result['htmlHas110'] is True
    assert result['htmlHasWords'] is True


def test_floating_dropdown_arrow_navigation_when_filtered(app):
    page, db, server = app
    page.locator('#screen').focus()
    page.keyboard.press('F8')
    page.wait_for_selector('#edit-form')

    party = page.locator('#edit-form [name=party]')
    party.focus()
    # Type to trigger floating dropdown filter
    page.keyboard.type('Cust')
    dropdown = page.locator('#floating-lookup-dropdown')
    expect(dropdown).to_be_visible()

    # Get initial selected option text
    selected_initial = dropdown.locator('.floating-option.selected').text_content()

    # Press ArrowDown: selection cursor should move
    page.keyboard.press('ArrowDown')
    selected_after_down = dropdown.locator('.floating-option.selected').text_content()

    # Press ArrowUp: selection cursor should move back
    page.keyboard.press('ArrowUp')
    selected_after_up = dropdown.locator('.floating-option.selected').text_content()

    assert selected_initial == selected_after_up
    assert selected_initial != selected_after_down or len(dropdown.locator('.floating-option').all()) == 1


def test_period_dialog_defaults_to_current_month(app):
    page, db, server = app
    page.locator('#screen').focus()
    page.keyboard.press('Alt+F2')
    expect(page.locator('#dialog')).to_be_visible()
    expect(page.locator('#dialog-title')).to_contain_text('Change Period')

    from_val = page.locator('#field-from').input_value()
    to_val = page.locator('#field-to').input_value()

    # Must start from current month (2026-10-01) and not year 2000 (2000-01-01)
    assert not from_val.startswith('2000'), f"Period should not start from year 2000, got: {from_val}"
    assert from_val.endswith('-01'), f"Period start should be first day of month, got: {from_val}"
    assert '2026' in from_val
    assert '2026' in to_val
    page.keyboard.press('Escape')


def test_inventory_warning_acknowledgement_saves_and_prompts_everytime(app):
    page, db, server = app
    page.locator('#screen').focus()
    page.keyboard.press('F8')
    page.wait_for_selector('#edit-form')

    # Steel has opening stock of 100 pcs. Enter 200 pcs (triggers negative stock warning).
    page.locator('#edit-form [name=party]').select_option('Customer')
    page.locator('#edit-form [name=account]').select_option('Sales')
    page.locator('#edit-form [name=item]').select_option('Steel')
    page.locator('#edit-form [name=qty]').fill('200')
    page.locator('#edit-form [name=rate]').fill('100')

    # Accept voucher via Ctrl+A
    page.keyboard.press('Control+a')

    # Acknowledgement dialog should appear with warning details
    expect(page.locator('#dialog')).to_be_visible()
    expect(page.locator('#dialog-title')).to_have_text('Acknowledgement')
    expect(page.locator('#dialog-body')).to_contain_text('Inventory warning acknowledgement required')
    expect(page.locator('#dialog-body')).to_contain_text('Steel: Negative stock')

    # Click OK to acknowledge and save
    page.locator('#dialog-body [data-action="confirm"]').click()
    expect(page.locator('#status')).to_have_text('Saved')

    # Verify a subsequent voucher with shortage prompts again every time
    page.locator('#screen').focus()
    page.keyboard.press('F8')
    page.wait_for_selector('#edit-form')

    page.locator('#edit-form [name=party]').select_option('Customer')
    page.locator('#edit-form [name=account]').select_option('Sales')
    page.locator('#edit-form [name=item]').select_option('Steel')
    page.locator('#edit-form [name=qty]').fill('50')
    page.locator('#edit-form [name=rate]').fill('100')

    page.keyboard.press('Control+a')

    expect(page.locator('#dialog')).to_be_visible()
    expect(page.locator('#dialog-title')).to_have_text('Acknowledgement')
    expect(page.locator('#dialog-body')).to_contain_text('Inventory warning acknowledgement required')

    page.locator('#dialog-body [data-action="confirm"]').click()
    expect(page.locator('#status')).to_have_text('Saved')


def test_item_section_only_skips_when_blank_and_selects_when_dropped_into_names(app):
    page, db, server = app
    page.locator('#screen').focus()
    page.keyboard.press('F8')
    page.wait_for_selector('#edit-form')

    page.locator('#edit-form [name=party]').select_option('Customer')
    page.locator('#edit-form [name=account]').select_option('Sales')

    # 1. When on blank section (Enter: skip), pressing Enter skips to extra table
    item_select = page.locator('#edit-form [name=item]').first
    item_select.focus()
    dropdown = page.locator('#floating-lookup-dropdown')
    expect(dropdown).to_be_visible()
    # Ensure highlight is on blank skip option by default
    assert 'skip' in dropdown.locator('.floating-option.selected').text_content().lower()
    page.keyboard.press('Enter')
    expect(page.locator('#extra-table [name=ledger]').first).to_be_focused()

    # 2. When dropping into item names via ArrowDown without typing, Enter selects the item
    item_select.focus()
    expect(dropdown).to_be_visible()
    page.keyboard.press('ArrowDown')
    selected_text = dropdown.locator('.floating-option.selected').text_content()
    assert 'skip' not in selected_text.lower(), f"Expected item name selected, got {selected_text}"

    # Pressing Enter MUST select the item and advance to quantity, NOT skip to extra ledgers!
    page.keyboard.press('Enter')
    expect(page.locator('#edit-form .inventory-entry').first.locator('[name=qty]')).to_be_focused()
    assert item_select.input_value() != ''
    expect(page.locator('#extra-table [name=ledger]').first).not_to_be_focused()


def test_stock_items_window_completely_removed_after_closing_voucher(app):
    page, db, server = app
    page.locator('#screen').focus()
    page.keyboard.press('F8')
    page.wait_for_selector('#edit-form')

    # Focus item control so floating lookup dropdown opens
    page.locator('#edit-form [name=item]').first.focus()
    expect(page.locator('#floating-lookup-dropdown')).to_be_visible()

    # First Escape closes the floating dropdown
    page.keyboard.press('Escape')
    expect(page.locator('#floating-lookup-dropdown')).to_have_count(0)

    # Second Escape returns to Gateway
    page.keyboard.press('Escape')
    expect(page.locator('#title')).to_have_text('Gateway of Books')

    # Floating dropdown MUST be completely gone from the DOM
    expect(page.locator('#floating-lookup-dropdown')).to_have_count(0)
    expect(page.locator('.floating-dropdown')).to_have_count(0)


def test_company_deletion_lifecycle(app):
    page, db, server = app
    initial_active = db.get_active_company_name()
    db.create_or_alter_company({'name': 'CoToDelete', 'starting_from': '20260401', 'ending_at': '20270331'})
    assert 'CoToDelete' in db.data['companies']
    assert db.get_active_company_name() == 'CoToDelete'

    db.delete_company('CoToDelete')
    assert 'CoToDelete' not in db.data['companies']
    assert db.get_active_company_name() != 'CoToDelete'

    with pytest.raises(ValueError):
        db.delete_company('CoToDelete')


