import json
import threading
from urllib.request import Request, urlopen

import pytest

from app_server import make_server

playwright_sync = pytest.importorskip('playwright.sync_api')
from playwright.sync_api import sync_playwright, expect


@pytest.fixture
def settings_server(tmp_path):
    server = make_server(0, str(tmp_path / 'books.sqlite3'))
    server.db.create_or_alter_company({
        'name': 'Settings Test', 'starting_from': '20260401', 'ending_at': '20270331'
    })
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        thread.join(timeout=3)
        server.server_close()


def request_json(server, method, path, payload=None):
    body=None
    headers={}
    if payload is not None:
        body=json.dumps(payload).encode()
        headers['Content-Type']='application/json'
    request=Request(f'http://127.0.0.1:{server.server_port}{path}', method=method,
                    data=body, headers=headers)
    try:
        with urlopen(request) as response:
            return response.status, json.loads(response.read())
    except Exception as error:
        response=error.fp
        return response.status, json.loads(response.read())


def test_billing_profile_api_round_trip_and_rejects_invalid_formula(settings_server):
    status, result = request_json(settings_server, 'GET', '/api/billing_profiles?company=Settings%20Test')
    assert status == 200
    assert result['profiles']['Sales']['formula'] == 'qty * rate'

    profiles=result['profiles']
    profiles['Sales']['formula']='alt_qty * rate'
    status, result = request_json(settings_server, 'POST', '/api/billing_profiles', {
        'company': 'Settings Test', 'profiles': profiles,
        'expected_revision': settings_server.db.data['revision'],
    })
    assert status == 200
    assert result['profiles']['Sales']['formula'] == 'alt_qty * rate'

    profiles['Sales']['formula']='qty ** rate'
    status, result = request_json(settings_server, 'POST', '/api/billing_profiles', {
        'company': 'Settings Test', 'profiles': profiles,
        'expected_revision': settings_server.db.data['revision'],
    })
    assert status == 400
    assert 'formula' in result['error'].lower()


@pytest.fixture
def settings_page(tmp_path):
    server = make_server(0, str(tmp_path / 'ui.sqlite3'))
    server.db.create_or_alter_company({
        'name': 'Settings Test', 'starting_from': '20260401', 'ending_at': '20270331'
    })
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='msedge', headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        page.set_default_timeout(8000)
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        page.wait_for_load_state('networkidle')
        yield page, server
        browser.close()
    server.shutdown()
    thread.join(timeout=3)
    server.server_close()


def test_billing_settings_editor_saves_formula_and_import_preview_accepts_multiple_files(settings_page, tmp_path):
    page, _ = settings_page
    page.keyboard.press('F12')
    expect(page.locator('#billing-formula')).to_have_value('qty * rate')
    page.locator('#billing-formula').fill('alt_qty * rate')
    page.locator('[data-action="billingAddField"]').click()
    page.locator('[data-action="saveBillingProfiles"]').click()
    expect(page.locator('#status')).to_have_text('Billing settings saved')

    page.keyboard.press('F12')
    expect(page.locator('#billing-formula')).to_have_value('alt_qty * rate')
    page.locator('[data-action="close"]').click()

    valid = tmp_path / 'accounts.xml'
    prompt = tmp_path / 'prompt.xml'
    valid.write_text('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><STATICVARIABLES><SVCURRENTCOMPANY>Settings Test</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE><LEDGER NAME="Imported"><PARENT>Sundry Debtors</PARENT></LEDGER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>')
    prompt.write_text('<ENVELOPE><LONGPROMPT>File Path:</LONGPROMPT></ENVELOPE>')
    page.locator('[data-action="import"]').first.click()
    page.locator('#field-importstart').fill('2026-04-01')
    page.locator('#field-importstart').click()
    expect(page.locator('.date-picker-popup')).to_be_visible()
    page.locator('[data-date-select="2026-04-15"]').click()
    expect(page.locator('#field-importstart')).to_have_value('2026-04-15')
    page.locator('#import-file').set_input_files([str(valid), str(prompt)])
    page.locator('[data-action="preview"]').click()
    expect(page.locator('#import-preview')).to_contain_text('Skipped prompt.xml')
