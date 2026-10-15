import pytest

pytest.importorskip('playwright.sync_api')
from playwright.sync_api import expect

from test_billing_settings_browser import settings_page
from test_browser_vouchers import app


def test_print_document_contains_business_voucher_only(settings_page):
    page, _ = settings_page
    page.evaluate("""() => {
      const model = window.IndependentPrintView.buildVoucherPrintModel({
        VOUCHERTYPENAME: 'Sales', VOUCHERNUMBER: 'S-1', DATE: '20260415',
        PARTYLEDGERNAME: 'Customer', BANKDATE: '20260416',
        'ALLINVENTORYENTRIES.LIST': [{STOCKITEMNAME: 'Steel', ACTUALQTY: '2 pcs', ALTQTY: '3 boxes', RATE: '100/pcs', AMOUNT: '200.00', GODOWNNAME: 'Hidden'}]
      }, {name: 'Print Company'}, null);
      const root = window.IndependentPrintView.renderPrintDocument(model);
      document.body.append(root);
    }""")
    expect(page.locator('.print-root')).to_contain_text('Print Company')
    expect(page.locator('.print-root')).to_contain_text('Alt Quantity')
    expect(page.locator('.print-root')).not_to_contain_text('Hidden')
    expect(page.locator('.print-root')).not_to_contain_text('Bank date')


def test_ctrl_p_overlay_and_layout_configurator(app):
    import re
    page, db, server = app
    # Open Sales voucher
    page.locator('#screen').focus()
    page.keyboard.press('F8')
    page.wait_for_selector('#edit-form')

    # Trigger Ctrl+P on voucher screen
    page.keyboard.press('Control+p')
    expect(page.locator('#dialog')).to_be_visible()
    expect(page.locator('#dialog-title')).to_contain_text('Print')
    expect(page.locator('[data-action="doPrintDirect"]')).to_be_visible()
    expect(page.locator('[data-action="doPrintPreview"]')).to_be_visible()
    expect(page.locator('[data-action="doPrintConfigure"]')).to_be_visible()

    # Click Configure
    page.locator('[data-action="doPrintConfigure"]').click()
    expect(page.locator('#dialog-title')).to_contain_text('Print Configuration')
    expect(page.locator('[name="borderMode"]')).to_be_visible()
    page.locator('[name="borderMode"]').select_option('borderless')
    page.locator('[data-action="savePrintConfig"]').click()

    # Trigger Ctrl+P again and open Preview
    page.keyboard.press('Control+p')
    page.locator('[data-action="doPrintPreview"]').click()
    expect(page.locator('.invoice-preview-container')).to_be_visible()
    expect(page.locator('.print-voucher')).to_have_class(re.compile(r'borderless'))
    # Close preview
    page.locator('[data-action="closePrintPreview"]').click()
    expect(page.locator('.invoice-preview-container')).not_to_be_visible()
