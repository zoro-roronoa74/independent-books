import json
import socket
import sys
import threading
from pathlib import Path
from urllib.request import Request, urlopen

import pytest

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'tests'))

from app_server import make_server
from books import Books
from test_browser_vouchers import app


def request_json(server, path):
    url = f"http://127.0.0.1:{server.server_port}{path}"
    req = Request(url)
    with urlopen(req) as resp:
        return resp.status, json.loads(resp.read().decode('utf-8'))


def test_air_gapped_isolation_zero_outbound_network(tmp_path, monkeypatch):
    """Verify that starting the server and loading data makes zero external outbound connections."""
    outbound_attempts = []
    real_connect = socket.socket.connect

    def guarded_connect(self, address):
        host = address[0] if isinstance(address, tuple) else address
        # Only allow connections to localhost / 127.0.0.1
        if host not in ('127.0.0.1', 'localhost', '::1'):
            outbound_attempts.append(address)
            raise ConnectionRefusedError(f"Air-gap violation: attempted connection to {address}")
        return real_connect(self, address)

    monkeypatch.setattr(socket.socket, 'connect', guarded_connect)

    db_path = tmp_path / 'local_books.sqlite3'
    server = make_server(0, str(db_path))
    server.db.create_or_alter_company({
        'name': 'AirGap Co',
        'starting_from': '20260401',
        'ending_at': '20270331',
        'state': 'West Bengal'
    })
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    try:
        # Call status and data
        status, res = request_json(server, '/api/status')
        assert status == 200
        assert res['independent'] is True

        status, data = request_json(server, '/api/data?company=AirGap%20Co')
        assert status == 200
        assert data['active_company'] == 'AirGap Co'

        # Assert no outbound connection outside localhost occurred
        assert len(outbound_attempts) == 0, f"Outbound network attempts detected: {outbound_attempts}"
        assert db_path.exists(), "Local SQLite database file must exist"
    finally:
        server.shutdown()
        thread.join(timeout=3)
        server.server_close()


def test_check_update_api_endpoint(tmp_path):
    """Verify /api/check_update endpoint returns version info and status."""
    db_path = tmp_path / 'update_test.sqlite3'
    server = make_server(0, str(db_path))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    try:
        status, res = request_json(server, '/api/check_update')
        assert status == 200
        assert res['status'] == 'success'
        assert 'current_version' in res
        assert 'update_available' in res
        assert isinstance(res['update_available'], bool)
    finally:
        server.shutdown()
        thread.join(timeout=3)
        server.server_close()


def test_build_installer_script_exists_and_has_required_assets():
    """Verify build_installer.ps1 exists and defines packaging for all core assets."""
    script_path = ROOT / 'build_installer.ps1'
    assert script_path.exists(), "build_installer.ps1 must exist"
    content = script_path.read_text(encoding='utf-8')
    # Check for references to core application files and desktop shortcut
    assert 'app_server.py' in content
    assert 'workflows.js' in content
    assert 'fidelity.css' in content
    assert 'Independent Books' in content
    assert '.lnk' in content or 'WScript.Shell' in content or 'Shortcut' in content


def test_two_sided_balance_sheet_and_pl_presentation(app):
    from playwright.sync_api import expect
    page, db, server = app
    # Open Balance Sheet
    page.locator('#screen').focus()
    page.keyboard.press('b')
    page.wait_for_selector('.report-caption')
    expect(page.locator('.dual')).to_be_visible()
    expect(page.locator('.dual th:has-text("Liabilities")')).to_be_visible()
    expect(page.locator('.dual th:has-text("Assets")')).to_be_visible()
    expect(page.locator('.report-total').first).to_be_visible()

    # Go back to gateway
    page.keyboard.press('Escape')
    # Open Profit & Loss A/c
    page.locator('#screen').focus()
    page.keyboard.press('p')
    page.wait_for_selector('.report-caption')
    expect(page.locator('.dual')).to_be_visible()
    expect(page.locator('.dual th:has-text("Expenses")')).to_be_visible()
    expect(page.locator('.dual th:has-text("Income")')).to_be_visible()
    expect(page.locator('.report-total').first).to_be_visible()
