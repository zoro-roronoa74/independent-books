import json
import sys
import threading
import urllib.request
import urllib.parse
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).parent))
from test_browser_vouchers import app

ROOT = Path(__file__).parents[1]
from books import Books
from app_server import make_server

def test_get_dashboard_metrics_calculation(tmp_path):
    db = Books(str(tmp_path / 'kpi_test.sqlite3'))
    db.create_or_alter_company({'name': 'KPI Corp', 'starting_from': '20260401', 'ending_at': '20270331'})
    db.save_master('KPI Corp', 'ledger', {'name': 'Customer X', 'parent': 'Sundry Debtors', 'opening_balance': '1200', 'drcr': 'Dr'})
    db.save_master('KPI Corp', 'ledger', {'name': 'Supplier Y', 'parent': 'Sundry Creditors', 'opening_balance': '800', 'drcr': 'Cr'})
    db.save_master('KPI Corp', 'ledger', {'name': 'Sales', 'parent': 'Sales Accounts', 'opening_balance': '0', 'drcr': 'Cr'})
    db.save_master('KPI Corp', 'ledger', {'name': 'Cash', 'parent': 'Cash-in-hand', 'opening_balance': '1000', 'drcr': 'Dr'})
    
    # Post a sales voucher for today (e.g. 20260405)
    today = '20260405'
    db.post_voucher('KPI Corp', {
        'VOUCHERTYPENAME': 'Sales', 'VOUCHERNUMBER': 'S-1', 'DATE': today,
        'ALLLEDGERENTRIES.LIST': [
            {'LEDGERNAME': 'Customer X', 'AMOUNT': '500', 'ISDEEMEDPOSITIVE': 'Yes'},
            {'LEDGERNAME': 'Sales', 'AMOUNT': '500', 'ISDEEMEDPOSITIVE': 'No'}
        ]
    })
    # Post a receipt voucher for today
    db.post_voucher('KPI Corp', {
        'VOUCHERTYPENAME': 'Receipt', 'VOUCHERNUMBER': 'R-1', 'DATE': today,
        'ALLLEDGERENTRIES.LIST': [
            {'LEDGERNAME': 'Cash', 'AMOUNT': '200', 'ISDEEMEDPOSITIVE': 'Yes'},
            {'LEDGERNAME': 'Customer X', 'AMOUNT': '200', 'ISDEEMEDPOSITIVE': 'No'}
        ]
    })
    
    metrics = db.get_dashboard_metrics('KPI Corp', date=today)
    assert metrics['today_sales']['amount'] == '500.00'
    assert metrics['today_sales']['count'] == 1
    assert metrics['today_collections'] == '200.00'
    # Debtors: 1200 + 500 - 200 = 1500
    assert metrics['due_from_customers'] == '1500.00'
    # Creditors: 800
    assert metrics['due_to_suppliers'] == '800.00'
    assert 'month_profit' in metrics
    assert 'trend' in metrics
    assert 'week' in metrics['trend']
    assert 'month' in metrics['trend']
    assert 'year' in metrics['trend']

def test_api_dashboard_metrics(tmp_path):
    server = make_server(0, str(tmp_path / 'kpi_api.sqlite3'))
    db = server.db
    db.create_or_alter_company({'name': 'API Co', 'starting_from': '20260401', 'ending_at': '20270331'})
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        url = f"http://127.0.0.1:{server.server_port}/api/dashboard_metrics?company={urllib.parse.quote('API Co')}&date=20260401"
        res = json.loads(urllib.request.urlopen(url, timeout=3).read())
        assert res['status'] == 'ok'
        assert 'metrics' in res
        assert 'today_sales' in res['metrics']
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)

def test_browser_gateway_kpi_dashboard(app):
    page, db, _ = app
    page.reload()
    page.wait_for_load_state('networkidle')
    # Check that KPI cards are visible in Gateway
    kpi_cards = page.locator('.kpi-card')
    assert kpi_cards.count() >= 4, "Expected at least 4 KPI cards on Gateway"
    
    # Check that trend chart exists
    chart = page.locator('.trend-chart svg')
    assert chart.count() >= 1, "Expected trend chart SVG"
    
    # Check trend toggle buttons
    week_btn = page.locator('button[data-trend="week"]')
    month_btn = page.locator('button[data-trend="month"]')
    year_btn = page.locator('button[data-trend="year"]')
    assert week_btn.is_visible()
    assert month_btn.is_visible()
    assert year_btn.is_visible()
    
    # Click today's sales KPI card and check navigation to Day Book
    sales_kpi = page.locator('[data-kpi="today_sales"]')
    sales_kpi.click()
    page.wait_for_selector('#title')
    assert 'Day Book' in page.locator('#title').inner_text()
