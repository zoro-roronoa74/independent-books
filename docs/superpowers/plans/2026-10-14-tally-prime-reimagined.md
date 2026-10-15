# Tally Prime Reimagined - Comprehensive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Independent Books into an upgraded, glassmorphic 1:1 open-source Tally Prime desktop application with in-place substring search, live Gateway KPI dashboard, state-aware item-level GST, dynamic multi-formula calculations, bulk Excel/CSV master imports, modular `Ctrl+P` printing, and standalone `.exe` installer packaging.

**Architecture:** Maintain a lightweight local Python REST backend (`app_server.py`, `books.py`, `billing_rules.py`) communicating with a pure vanilla JavaScript and CSS glassmorphic frontend (`workflows.js`, `fidelity.css`, `lookup_context.js`, `print_view.js`). All accounting calculations are backed by Python `Decimal` arithmetic for exact precision. The entire app runs air-gapped without external dependencies and stays under 50 MB RAM.

**Tech Stack:** Python 3.9+, SQLite3, Vanilla JavaScript (ES2022), CSS3 (Glassmorphism, backdrop-filter, CSS Grid/Flexbox), Node.js (test runners), Playwright (browser verification).

**Spec:** `docs/superpowers/specs/2026-10-14-tally-prime-reimagined-architecture-design.md`

## Global Constraints

- **Strict Double-Entry Invariant**: Total Debit must equal Total Credit for every committed voucher.
- **High-Precision Decimal Arithmetic**: Financial calculations, GST splits, and formulas must use Python `Decimal` with 2-decimal half-up rounding. Zero float discrepancies.
- **Air-Gapped Local Privacy**: No telemetry, analytics, or outbound internet network requests. All data lives in local SQLite.
- **Lightweight Low-Spec Footprint**: RAM usage must remain under 50 MB; UI transitions must use GPU-accelerated CSS (`transform`, `opacity`) running at 60 fps.
- **No Emojis**: Use minimalist SVG vector icons for settings (gear), calendar, printer, and search.
- **Clean-Slate Architecture**: No forced industry presets. All formulas and columns are unopinionated and configurable by the user.

## Review Focus

1. **In-place typing collision with existing keyboard navigation**: Arrow Up/Down and Enter in the floating dropdown must not prematurely trigger form submission or jump to other rows. (Test in Task 3).
2. **Auto-select & Overwrite-on-Type**: Typing into a populated rate or item box must overwrite completely without appending to old text. (Test in Task 3 and Task 5).
3. **State-aware GST calculation**: Intra-state must split item tax 50/50 into CGST and SGST; inter-state must consolidate into IGST; 0% items must generate no tax. (Test in Task 6).
4. **Custom formula evaluation safety**: Formulas must evaluate mathematical expressions safely without `eval()` vulnerabilities and handle division by zero gracefully. (Test in Task 7).
5. **Bulk template Excel & CSV fidelity**: Uploading files must handle missing optional columns, duplicate names, and invalid groups with clear error reporting and rollback. (Test in Task 8).

---

### Task 1: Glassmorphic Visual System & SVG Iconography

**Files:**
- Modify: `fidelity.css:1-250`
- Modify: `index.html:1-35`
- Test: `tests/test_glassmorphic_theme.py`

**Interfaces:**
- Consumes: CSS root variables, DOM tree.
- Produces: Translucent dark emerald glass cards (`backdrop-filter: blur(14px)`), smooth rounded corners (`border-radius: 12px`), minimalist SVG icons for Settings gear (`F12`), Calendar (`F2`), Printer (`Ctrl+P`), and search lens.

- [ ] **Step 1: Write browser test asserting glassmorphic styling and SVG icons**
  Assert that `#keys`, `.dialog`, cards, and table inputs have rounded corners, backdrop-filter, SVG icons for `[data-shortcut="F12"]` and `[data-shortcut="F2"]`, and zero emoji characters.
- [ ] **Step 2: Run test and verify failure**
  Run `pytest -q tests/test_glassmorphic_theme.py` and confirm failure.
- [ ] **Step 3: Update `fidelity.css` and `index.html`**
  Implement glassmorphic backdrop filters, border radii, SVG icon definitions, and smooth 180ms CSS transitions.
- [ ] **Step 4: Verify test passes**
  Run `pytest -q tests/test_glassmorphic_theme.py` and verify 100% pass.

---

### Task 2: Gateway Live KPI Dashboard & Performance Trend Chart

**Files:**
- Modify: `app_server.py:120-200`
- Modify: `books.py:400-500`
- Modify: `workflows.js:180-230`
- Test: `tests/test_gateway_dashboard.py`

**Interfaces:**
- Consumes: `Books.get_company()`, voucher history, ledger balances.
- Produces: `/api/dashboard_metrics` endpoint returning today's sales (count & amount), today's collections, debtors balance, creditors balance, this month's net profit, and historical sales series; `workflows.js` renders the interactive dashboard on Gateway.

- [ ] **Step 1: Write backend and UI tests for dashboard metrics**
  Assert that `/api/dashboard_metrics` returns correct calculated figures and that the Gateway screen renders the 5 KPI cards and vector sales graph with Week/Month/Year buttons.
- [ ] **Step 2: Run test and verify failure**
  Run `pytest -q tests/test_gateway_dashboard.py`.
- [ ] **Step 3: Implement dashboard backend in `books.py` and `app_server.py`**
  Add `get_dashboard_metrics(company)` calculating today's sales, collections, due from customers (Debtors), due to suppliers (Creditors), and month's profit.
- [ ] **Step 4: Implement Gateway KPI rendering in `workflows.js`**
  Replace the left side of Gateway with KPI cards linking to Day Book and an interactive SVG trend graph.
- [ ] **Step 5: Verify test passes**
  Run `pytest -q tests/test_gateway_dashboard.py` and confirm pass.

---

### Task 3: In-Place Substring Search, Floating Dropdown & Overwrite-on-Type

**Files:**
- Modify: `lookup_context.js:140-184`
- Modify: `workflows.js:30-100, 390-450`
- Modify: `fidelity.css:250-320`
- Test: `tests/test_inplace_search_browser.py`
- Test: `tests/test_contextual_lookup.js`

**Interfaces:**
- Consumes: `lookupContext`, input keystrokes.
- Produces: Floating dropdown attached directly beneath inputs, substring matching anywhere in the string, full selection on focus (`select()`), overwrite on typing, Enter selection and advancement.

- [ ] **Step 1: Write browser test for in-place substring typing and overwrite**
  Assert typing into `[name=party]` or `[name=item]` opens a floating dropdown matching text anywhere (middle/first), pressing Backspace selects existing text for overwrite, and Enter selects and advances.
- [ ] **Step 2: Run test and confirm failure**
  Run `pytest -q tests/test_inplace_search_browser.py`.
- [ ] **Step 3: Implement in-place dropdown and selection in `workflows.js`**
  Anchor the floating list under active input, hook `input` events for substring filtering, add `focus` auto-select handlers, and wire Arrow/Enter navigation.
- [ ] **Step 4: Verify test passes**
  Run `pytest -q tests/test_inplace_search_browser.py` and `node tests/test_contextual_lookup.js`.

---

### Task 4: Real-World Current Date Defaults & Voucher Table Cleanup

**Files:**
- Modify: `date_picker.js:1-120`
- Modify: `workflows.js:230-300, 720-740`
- Test: `tests/test_date_picker.js`
- Test: `tests/test_browser_vouchers.py`

**Interfaces:**
- Consumes: System calendar date, voucher DOM.
- Produces: Date picker defaulting to current year (2026), removal of "Additional ledgers" and "GST rows appear automatically" banners, unified continuous rows for items and expenses.

- [ ] **Step 1: Write test for current date defaulting and absence of clutter banners**
  Assert date picker initializes to today's year/month/day, and voucher screen does not contain "Additional ledgers" or GST banner text.
- [ ] **Step 2: Run test and verify failure**
  Run `node tests/test_date_picker.js` and `pytest -q tests/test_browser_vouchers.py -k "clutter or date"`.
- [ ] **Step 3: Update `date_picker.js` and `workflows.js`**
  Initialize picker with `new Date()`, remove boilerplate banners, and style bottom expense rows continuously below items.
- [ ] **Step 4: Verify test passes**
  Run `node tests/test_date_picker.js` and `pytest -q tests/test_browser_vouchers.py`.

---

### Task 5: Stock Item Standard Rates & Overwrite-on-Type Flow

**Files:**
- Modify: `books.py:200-280`
- Modify: `app_server.py:250-320`
- Modify: `workflows.js:380-450`
- Test: `tests/test_standard_rates.py`

**Interfaces:**
- Consumes: Stock item definitions (`standard_purchase_rate`, `standard_selling_rate`).
- Produces: Auto-filling selling rate on Sales and purchase rate on Purchase; auto-highlighting rate input for instant overwrite; bulk item rates manager in Gateway.

- [ ] **Step 1: Write tests for standard rate persistence and auto-fill**
  Assert stock items store standard rates, Sales voucher auto-populates selling rate, Purchase auto-populates purchase rate, and rate box is selected for instant overwrite.
- [ ] **Step 2: Run test and verify failure**
  Run `pytest -q tests/test_standard_rates.py`.
- [ ] **Step 3: Implement standard rates in `books.py` and `workflows.js`**
  Add fields in `save_stock_item`, wire auto-population in voucher line generation, and add Gateway "Item Rates Manager" view.
- [ ] **Step 4: Verify test passes**
  Run `pytest -q tests/test_standard_rates.py`.

---

### Task 6: Dynamic State-Aware Item-Level GST Engine

**Files:**
- Modify: `books.py:300-380`
- Modify: `billing_rules.py:100-200`
- Modify: `workflows.js:250-310`
- Test: `tests/test_item_gst_engine.py`

**Interfaces:**
- Consumes: Item registered GST rates, Company State, Party State.
- Produces: Automatic CGST + SGST (intra-state 50/50 split) or IGST (inter-state full rate) rows; exemption for 0% items; high-precision `Decimal` calculation.

- [ ] **Step 1: Write tests for intra-state and inter-state item GST calculations**
  Assert 18% item in same state produces 9% CGST + 9% SGST; in inter-state produces 18% IGST; 0% item produces no tax.
- [ ] **Step 2: Run test and verify failure**
  Run `pytest -q tests/test_item_gst_engine.py`.
- [ ] **Step 3: Implement state-aware item GST in `billing_rules.py` and `books.py`**
  Compare state codes, compute item tax amounts with `Decimal`, group by tax type, and append summary tax rows.
- [ ] **Step 4: Verify test passes**
  Run `pytest -q tests/test_item_gst_engine.py`.

---

### Task 7: Contextual F12 Settings & Dynamic Formula Manager

**Files:**
- Modify: `billing_rules.py:1-120`
- Modify: `workflows.js:460-520`
- Test: `tests/test_contextual_f12.py`
- Test: `tests/test_billing_rules.py`

**Interfaces:**
- Consumes: Screen context (`voucher`, `report`, `master`), user formula strings.
- Produces: Screen-specific F12 configuration dialogs; live evaluation of custom formulas (e.g., `weight_per_pc = alt_qty / qty`) across voucher lines.

- [ ] **Step 1: Write tests for contextual F12 and multi-formula evaluation**
  Assert F12 on Day Book shows report settings; F12 on Sales shows formula/voucher settings; custom formula calculates live without syntax errors.
- [ ] **Step 2: Run test and verify failure**
  Run `pytest -q tests/test_contextual_f12.py`.
- [ ] **Step 3: Implement contextual F12 and multi-formula evaluator**
  Scope F12 handler to active screen kind; enhance formula evaluator in `billing_rules.py` to support multiple custom column expressions safely.
- [ ] **Step 4: Verify test passes**
  Run `pytest -q tests/test_contextual_f12.py` and `node tests/test_voucher_logic.js`.

---

### Task 8: Downloadable Bulk Sample Templates & Bulk Ingestion Engine

**Files:**
- Modify: `app_server.py:350-450`
- Modify: `interchange.py:100-250`
- Modify: `workflows.js:330-380`
- Test: `tests/test_bulk_master_templates.py`

**Interfaces:**
- Consumes: Uploaded `.xlsx` / `.csv` files.
- Produces: Downloadable sample files (`sample_bulk_ledgers.xlsx`, `sample_bulk_items.xlsx`, `.csv` counterparts); batch validation and upsert endpoint `/api/bulk_import`.

- [ ] **Step 1: Write tests for sample template downloads and bulk upsert**
  Assert sample templates have required headers, and uploading a filled sample file correctly creates/updates ledgers and items in a single transaction.
- [ ] **Step 2: Run test and verify failure**
  Run `pytest -q tests/test_bulk_master_templates.py`.
- [ ] **Step 3: Implement sample generation and bulk import in `app_server.py` & `interchange.py`**
  Build endpoints `/api/sample_template` and `/api/bulk_import` with row validation and atomic commit/rollback.
- [ ] **Step 4: Verify test passes**
  Run `pytest -q tests/test_bulk_master_templates.py`.

---

### Task 9: Modular `Ctrl+P` Print Overlay & Invoice Layout Configurator

**Files:**
- Modify: `print_view.js:1-150`
- Modify: `workflows.js:730-760`
- Modify: `fidelity.css:320-400`
- Test: `tests/test_print_view.js`
- Test: `tests/test_print_browser.py`

**Interfaces:**
- Consumes: Voucher data, company metadata, print layout settings.
- Produces: 3-button overlay (`Print`, `Preview`, `Configure`); layout configurator for borders, header height/fields, and footer bank/terms/signatory.

- [ ] **Step 1: Write test for Ctrl+P popup and print customization**
  Assert `Ctrl+P` opens the 3-button modal, `Configure` toggles borders and header/footer elements, and `Preview` reflects changes.
- [ ] **Step 2: Run test and verify failure**
  Run `pytest -q tests/test_print_browser.py` and `node tests/test_print_view.js`.
- [ ] **Step 3: Implement 3-action dialog and modular print template**
  Add `Ctrl+P` modal in `workflows.js` and modular template configuration options in `print_view.js`.
- [ ] **Step 4: Verify test passes**
  Run `pytest -q tests/test_print_browser.py` and `node tests/test_print_view.js`.

---

### Task 10: Standalone `.exe` Installer Packaging, Security & Update Checker

**Files:**
- Create: `build_installer.ps1`
- Modify: `app_server.py:50-80`
- Modify: `workflows.js:200-240`
- Test: `tests/test_security_and_packaging.py`

**Interfaces:**
- Consumes: Application directory, embedded runtime.
- Produces: Installer build script generating standalone `.exe` with embedded runtime, air-gapped verification, and on-demand `/api/check_update` endpoint with UI badge.

- [ ] **Step 1: Write tests for air-gapped security and update endpoint**
  Assert that the application makes zero external network requests on startup, database is strictly local, and `/api/check_update` returns version information when requested.
- [ ] **Step 2: Run test and verify failure**
  Run `pytest -q tests/test_security_and_packaging.py`.
- [ ] **Step 3: Implement `build_installer.ps1` and `/api/check_update`**
  Package embedded Python runtime into standalone executable structure, create shortcut installer script, and add update check action in Gateway Help.
- [ ] **Step 4: Verify test passes**
  Run `pytest -q tests/test_security_and_packaging.py`.

---

### Task 11: End-to-End Regression & Performance Benchmark

**Files:**
- Run full test suite across Python, Node.js, and Playwright browser tests.
- Review memory consumption and UI responsiveness.

- [ ] **Step 1: Run complete project test suite**
  ```powershell
  $env:PYTHONPATH='.'; python -m pytest -q
  ```
- [ ] **Step 2: Run complete JavaScript test suite**
  ```powershell
  node tests/test_contextual_lookup.js
  node tests/test_voucher_logic.js
  node tests/test_phase1_logic.js
  node tests/test_date_picker.js
  node tests/test_print_view.js
  ```
- [ ] **Step 3: Run syntax validation**
  ```powershell
  python -m compileall -q app_server.py billing_rules.py books.py interchange.py tests
  node --check lookup_context.js
  node --check workflows.js
  node --check print_view.js
  node --check date_picker.js
  ```
- [ ] **Step 4: Verify live execution**
  Launch via `Launch.ps1 -NoBrowser`, verify `/api/status`, and confirm smooth startup with zero console errors.
