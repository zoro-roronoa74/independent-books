import json
import time
import pytest
playwright_sync = pytest.importorskip('playwright.sync_api')
from playwright.sync_api import sync_playwright

from app_server import make_server
from books import Books


def test_special_thanks_and_no_ad_slot(tmp_path):
    server = make_server(0, str(tmp_path / 'features_test.sqlite3'))
    db = server.db
    db.create_or_alter_company({'name': 'Sahil Enterprises', 'starting_from': '20260401', 'ending_at': '20270331'})

    import threading
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_port
    url = f"http://127.0.0.1:{port}"

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='msedge', headless=True)
            page = browser.new_page(viewport={'width': 1440, 'height': 1000})
            page.goto(url)
            page.wait_for_selector('.brand')
            
            # 1. Verify Special Thanks button in lowest corner of footer
            thanks_btn = page.query_selector('.footer-thanks-btn')
            assert thanks_btn is not None, "Special Thanks button must be in the footer"
            thanks_btn.click()
            page.wait_for_selector('.special-thanks-modal')
            modal_text = page.inner_text('.special-thanks-modal')
            assert 'Sahil Mondal' in modal_text, "Author Sahil Mondal must appear"
            assert 'Antigravity' in modal_text, "Special thanks to Antigravity must appear"
            assert 'Omnirush' in modal_text, "Special thanks to Omnirush must appear"
            assert 'REA' not in modal_text, "REA should not appear in Special Thanks"
            
            # Close dialog
            page.click('.special-thanks-modal [data-action="close"]')
            time.sleep(0.2)
            
            # 2. Verify ad slot is removed per user request
            ad_slot = page.query_selector('.gateway-ad-space')
            assert ad_slot is None, "Gateway ad slot should be removed for now"

            browser.close()
    finally:
        server.shutdown()
        server.server_close()
