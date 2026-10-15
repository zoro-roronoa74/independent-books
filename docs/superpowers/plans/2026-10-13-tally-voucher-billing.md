# Tally Import, Voucher UX, Calendar, Printing, and Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use native execution in this session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import complete Tally XML company bundles and deliver calendar-driven dates, compact configurable vouchers, deterministic billing calculations, and dedicated printing without regressing existing accounting workflows.

**Architecture:** Keep the existing standard-library Python/SQLite backend and vanilla JavaScript UI. Add a normalized Tally bundle planner, a small Decimal-backed billing-rule kernel, a dependency-free date-picker module, and pure print-model/rendering helpers. The server remains authoritative for import validation and saved billing amounts; the browser provides previews and interaction only.

**Tech Stack:** Python 3 standard library, SQLite, `xml.etree.ElementTree`, `decimal.Decimal`, vanilla JavaScript, HTML/CSS, pytest, Node tests, Playwright browser tests.

**Spec:** `docs/superpowers/specs/2026-10-13-tally-voucher-billing-design.md`

## Global Constraints

- Use only the project’s existing standard-library Python, vanilla JavaScript, SQLite, pytest, Node, and browser-test tooling.
- Never use JavaScript or Python `eval` for billing formulas.
- Use isolated temporary SQLite databases or `tests/scratch_books.sqlite3` for all new tests and live checks.
- Do not modify `C:\Users\Public\TallyPrime\data\100000` or the active real database.
- Preserve source XML, hidden voucher fields, stable voucher identities, existing bill allocation data, and unknown imported fields.
- Keep imports atomic and reject invalid or mismatched calculations before committing.
- Preserve existing Phase 1–4 behavior and run the full regression suite before completion.

## Review Focus

- A bundle containing a prompt-only XML file and separate account-list/day-book files must import real messages, skip the prompt, and report the skip. Test in Task 1.
- A late invalid voucher must leave every destination master and voucher unchanged. Test in Task 1.
- A formula using alternate quantity must calculate with Decimal semantics and reject client/server mismatches. Test in Task 2.
- Existing vouchers containing hidden bank-date, reference, or godown data must retain those fields after an unchanged edit. Test in Task 5.
- Print output must contain the business voucher/report and exclude application chrome and hidden fields. Test in Task 6.

---

### Task 1: Normalize and import Tally XML bundles

**Files:**
- Modify: `interchange.py`
- Modify: `app_server.py`
- Create: `tests/test_tally_bundle_import.py`
- Use fixtures: `C:\Users\Prime Steel\AppData\Local\Temp\omnirush\tally-snapshot\100003-list-of-accounts.xml`, `100003-day-book.xml`, and prompt-only `100003-all-masters.xml`

**Interfaces:**
- Produces `parse_tally_bundle(xmls: list[dict | str]) -> dict` with normalized messages, source company metadata, skipped-file warnings, and source-file context.
- Produces `apply_import(books: Books, payload: dict) -> dict` support for both legacy `xml` and new ordered `xmls` payloads.
- Returns JSON-safe counts with `companies`, `masters`, `vouchers`, `updated`, `warnings`, `skipped`, and contextual `errors`/failure information.

- [ ] **Step 1: Write the failing tests**
  - Assert the two real `100003` files combine into one company import with groups/ledgers and vouchers.
  - Assert the prompt-only file is skipped and listed in warnings/skipped results.
  - Assert `COMPANY/REMOTECMPNAME` and `SVCURRENTCOMPANY` identify the destination company.
  - Assert a deliberately invalid late voucher raises with file/entity context and the candidate database remains byte-for-byte unchanged.
  - Assert stable `REMOTEID`/GUID values prevent duplicate voucher creation on repeated import.

- [ ] **Step 2: Run the focused tests to verify RED**

  Run: `python -m pytest tests/test_tally_bundle_import.py -q`

  Expected: FAIL because the current importer accepts only one XML payload and does not normalize the Tally bundle shape.

- [ ] **Step 3: Implement bundle parsing in `interchange.py`**
  - Parse each XML document independently with `ElementTree`.
  - Classify documents with no `TALLYMESSAGE` as prompt-only.
  - Collect `TALLYMESSAGE` children without treating namespace-qualified UDF tags as entity names.
  - Extract company name and remote identity from `SVCURRENTCOMPANY`, `COMPANY`, and `REMOTECMPNAME`.
  - Attach file index/name, entity type, source name, GUID, REMOTEID, and raw XML context to normalized records.
  - Normalize Tally system-group spelling/case without changing user ledger names.
  - Preserve raw message XML and unrecognized fields through `source_imports`/metadata.

- [ ] **Step 4: Implement ordered candidate application**
  - Extend `_candidate` to accept `xmls` while retaining the legacy `xml` path.
  - Apply company metadata and masters in dependency order before vouchers.
  - Match stable IDs first and normalized names second.
  - Validate all references before candidate commit.
  - Return structured counts, warnings, skipped files, and contextual errors.
  - Keep the existing candidate-copy/commit behavior so failed imports do not mutate `books.data`.

- [ ] **Step 5: Update the HTTP boundary**
  - Accept `xmls` in `/api/import_preview` and `/api/import`.
  - Preserve single-`xml` compatibility.
  - Return the structured import report without exposing internal `Books` objects.

- [ ] **Step 6: Run focused tests to verify GREEN**

  Run: `python -m pytest tests/test_tally_bundle_import.py -q`

  Expected: all bundle import tests pass, including prompt skipping, real snapshot import, duplicate prevention, and rollback.

---

### Task 2: Add the authoritative billing-rule kernel

**Files:**
- Create: `billing_rules.py`
- Modify: `books.py`
- Modify: `tests/conftest.py` if a shared company profile fixture is needed
- Create: `tests/test_billing_rules.py`

**Interfaces:**
- `parse_billing_formula(expression: str, allowed_fields: set[str]) -> AST`.
- `evaluate_billing_formula(expression: str, values: dict[str, Decimal], currency_quantum: str = '0.01') -> Decimal`.
- `default_billing_profiles() -> dict[str, dict]`.
- `Books.billing_profiles(company: str) -> dict[str, dict]`.
- `Books.validate_billing_rows(company: str, voucher_type: str, rows: list[dict], client_amounts: list[str] | None = None) -> list[dict]`.

- [ ] **Step 1: Write failing Python tests**
  - Test `qty * rate`, alternate-quantity formulas, parentheses, unary signs, percentages, and Decimal rounding.
  - Test unknown names, malformed syntax, division by zero, non-finite values, and unsupported operators.
  - Test default profiles for Sales and Purchase.
  - Test client amount mismatch rejection.
  - Test profile persistence through company creation and portable backup round trip.

- [ ] **Step 2: Run the focused tests to verify RED**

  Run: `python -m pytest tests/test_billing_rules.py -q`

  Expected: FAIL because no billing-rule module/profile/evaluator exists.

- [ ] **Step 3: Implement a restricted parser/evaluator**
  - Tokenize decimal literals, identifiers, parentheses, and only `+ - * / %`.
  - Build a small AST with explicit node types or tuples.
  - Evaluate with `Decimal`, finite checks, explicit division-by-zero handling, and currency quantization only at the result boundary.
  - Reject names not in the profile’s allowed numeric fields.

- [ ] **Step 4: Add company profile defaults and validation**
  - Add default `billing_profiles` for inventory voucher base types without changing existing company data shape incompatibly.
  - Validate profile field keys, labels, ordering, required state, formula names, and duplicate keys.
  - Store profiles as company data so backup/export retains them.

- [ ] **Step 5: Make voucher validation authoritative**
  - Validate row values and recalculate amount in `Books` before inventory/GST posting.
  - Compare any client-supplied amount after the currency rounding policy.
  - Return calculated rows for preview/save responses.

- [ ] **Step 6: Run focused tests to verify GREEN**

  Run: `python -m pytest tests/test_billing_rules.py tests/test_phase1_books.py tests/test_phase2_bills.py tests/test_phase3_inventory.py -q`

  Expected: billing tests and existing accounting/bill/inventory tests pass.

---

### Task 3: Expose billing settings and multi-file import in the API/UI

**Files:**
- Modify: `app_server.py`
- Modify: `workflows.js`
- Modify: `fidelity.css`
- Modify: `tests/test_client_rules.py`
- Create: `tests/test_billing_settings_browser.py`

**Interfaces:**
- `GET /api/billing_profiles?company=...` returns sanitized profiles.
- `POST /api/billing_profiles` validates and saves `{company, profiles, expected_revision}`.
- Import dialog accepts `multiple` XML files and sends `{xmls: [{name, text}, ...], company, ...}`.

- [ ] **Step 1: Write failing API/browser tests**
  - Settings load default profiles.
  - Valid profile updates persist; invalid fields/formulas are rejected.
  - Import dialog accepts multiple XML files and preview displays skipped files/counts.

- [ ] **Step 2: Run tests to verify RED**

  Run: `python -m pytest tests/test_billing_settings_browser.py -q`

  Expected: FAIL because the endpoints and multi-file dialog behavior do not exist.

- [ ] **Step 3: Implement API endpoints**
  - Add GET/POST routes with company and revision validation.
  - Return structured errors and never partially save invalid profiles.

- [ ] **Step 4: Implement settings UI**
  - Add a billing section to the existing Configuration dialog.
  - Render profile selection by voucher base type, field rows, label/order controls, numeric-field addition/removal, formula input, and save/validation feedback.
  - Use the existing dialog/status/error patterns.

- [ ] **Step 5: Implement multi-file import UI**
  - Change the source input to `multiple` XML selection.
  - Read files in selection order and send names/texts to preview/apply.
  - Display counts, skipped files, warnings, and contextual errors.

- [ ] **Step 6: Run focused tests to verify GREEN**

  Run: `python -m pytest tests/test_billing_settings_browser.py -q`

  Expected: settings and multi-file import tests pass.

---

### Task 4: Add the calendar picker and client billing parity helpers

**Files:**
- Create: `date_picker.js`
- Modify: `index.html`
- Modify: `workflows.js`
- Modify: `voucher_logic.js`
- Modify: `fidelity.css`
- Create: `tests/test_date_picker.js`
- Modify: `tests/test_voucher_logic.js`

**Interfaces:**
- `createDatePicker({onSelect})`/module equivalent with `open(control)`, `close()`, and month navigation.
- `voucher_logic.js` exposes `evaluateBillingFormula` or an equivalent parity API using the same grammar/fixtures as Python.

- [ ] **Step 1: Write failing JavaScript tests**
  - Test calendar month transitions across year boundaries.
  - Test leap-year day selection and normalized ISO output.
  - Test typed date and `+`/`-` behavior remains unchanged.
  - Test client formula fixtures equal expected rounded strings.

- [ ] **Step 2: Run tests to verify RED**

  Run: `node tests/test_date_picker.js; node tests/test_voucher_logic.js`

  Expected: the new date-picker and formula-parity tests fail before implementation.

- [ ] **Step 3: Implement `date_picker.js`**
  - Use event delegation for dynamically-rendered `.tally-date` and voucher date fields.
  - Render month title, previous/next controls, weekday headings, day buttons, and selected state.
  - Support keyboard escape, arrows, enter, and focus return.
  - Dispatch input/change after selection.

- [ ] **Step 4: Integrate the picker and billing preview**
  - Load the module from `index.html` before `workflows.js`.
  - Replace hidden/native calendar suppression with the custom popup.
  - Use the selected billing profile to render fields and calculate preview amounts.
  - Keep `productMoney` as a safe decimal-string helper or replace it with the parity evaluator; do not use floating-point multiplication for saved amounts.

- [ ] **Step 5: Run JavaScript tests to verify GREEN**

  Run: `node tests/test_date_picker.js; node tests/test_voucher_logic.js; node tests/test_phase1_logic.js`

  Expected: all new and existing JavaScript assertions pass.

---

### Task 5: Replace the voucher form with the compact configurable layout

**Files:**
- Modify: `workflows.js`
- Modify: `fidelity.css`
- Modify: `books.py` only where final row normalization/hidden-field preservation is required
- Create: `tests/test_compact_voucher_browser.py`

**Interfaces:**
- Compact item row DOM fields: `[name=item]`, `[name=qty]`, `[name=alt_qty]`, `[name=rate]`, `[name=itemamount]`.
- `collectVoucher()` continues to return the existing Tally-style voucher payload and preserves untouched hidden fields.

- [ ] **Step 1: Write failing browser tests**
  - Sales and Purchase show party before account ledger.
  - Inventory row headers/order are Item, Quantity, Alt Quantity, Rate, Amount.
  - No godown, reference-type, or bank-date controls appear in the normal form.
  - Adding rows preserves order and saves server-authoritative amounts.
  - An existing voucher with hidden fields retains them after an unchanged edit.

- [ ] **Step 2: Run tests to verify RED**

  Run: `python -m pytest tests/test_compact_voucher_browser.py -q`

  Expected: FAIL because the current form includes godown/reference/bank-date controls and lacks alternate quantity/profile rendering.

- [ ] **Step 3: Implement the compact header and row renderer**
  - Reorder party/account fields.
  - Render configurable row fields in profile order with default item/qty/alt_qty/rate/amount.
  - Remove normal-form godown, reference-type, and bank-date controls.
  - Keep the explicit billing action separate from row presentation.

- [ ] **Step 4: Implement collection and hidden-field preservation**
  - Map main quantity to `ACTUALQTY` and alternate quantity to `BILLEDQTY` with units.
  - Preserve original allocation/reference/bank-date fields when unchanged.
  - Reject changed rows with unsupported multi-allocation data rather than silently dropping allocations.
  - Send raw row values/profile ID for server validation.

- [ ] **Step 5: Run compact browser tests and existing voucher tests**

  Run: `python -m pytest tests/test_compact_voucher_browser.py tests/test_browser_vouchers.py tests/test_phase1_browser.py tests/test_phase2_browser.py tests/test_phase3_browser.py -q`

  Expected: compact layout, hidden-field preservation, and previous voucher workflows pass.

---

### Task 6: Add dedicated voucher/report print models and rendering

**Files:**
- Create: `print_view.js`
- Modify: `workflows.js`
- Modify: `index.html`
- Modify: `fidelity.css`
- Create: `tests/test_print_view.js`
- Create: `tests/test_print_browser.py`

**Interfaces:**
- `buildVoucherPrintModel(voucher, company, profile) -> print model`.
- `buildReportPrintModel(root) -> print model` or equivalent DOM-safe renderer.
- `renderPrintDocument(model) -> HTMLElement`.

- [ ] **Step 1: Write failing model/browser tests**
  - Inventory model includes party, voucher metadata, item, quantity, alternate quantity, rate, amount, totals, and narration.
  - Accounting model includes ledger rows and totals.
  - Models exclude reference type, bank date, godown, and application controls.
  - Browser print action creates `.print-root` and calls the print boundary without replacing the application permanently.

- [ ] **Step 2: Run tests to verify RED**

  Run: `node tests/test_print_view.js; python -m pytest tests/test_print_browser.py -q`

  Expected: FAIL because current print action calls `window.print()` on the application shell.

- [ ] **Step 3: Implement pure print models/renderers**
  - Build business-only models from current draft/original voucher data.
  - Render clean tables and signature blocks with escaped values.
  - Render current reports without copying ribbon, sidebars, dialogs, or controls.

- [ ] **Step 4: Integrate print lifecycle and CSS**
  - Load `print_view.js` before `workflows.js`.
  - Route `data-action="print"` to the dedicated renderer.
  - Add print page margins, repeated table headers, currency alignment, and `afterprint` cleanup/focus restoration.

- [ ] **Step 5: Run print tests to verify GREEN**

  Run: `node tests/test_print_view.js; python -m pytest tests/test_print_browser.py -q`

  Expected: print model and browser content tests pass.

---

### Task 7: Documentation, regression verification, and isolated live gate

**Files:**
- Modify: `README.md`
- Create: `docs/verification/tally-voucher-billing.md`
- Modify: `tests/live_phase_check.py` only if a new isolated check is required

- [ ] **Step 1: Write documentation checks as a checklist**
  - Document supported Tally XML bundle inputs, prompt-only skip behavior, atomicity, and `.1800`/`.TSF` limitation.
  - Document compact voucher field order and hidden-field preservation.
  - Document billing profile grammar and server-authoritative calculation.
  - Document the dedicated print behavior.

- [ ] **Step 2: Run the full regression suite**

  Run: `$env:PYTHONPATH='C:\Users\PRIMES~1\AppData\Local\Temp\omnirush\ib-browser-deps'; $env:NODE_OPTIONS=''; python -m pytest tests -q`

  Expected: all Python/browser tests pass with zero failures.

- [ ] **Step 3: Run JavaScript and syntax checks**

  Run: `node tests/test_voucher_logic.js; node tests/test_phase1_logic.js; python -m py_compile books.py interchange.py app_server.py billing_rules.py`

  Expected: all assertions pass and compilation exits successfully.

- [ ] **Step 4: Run isolated live verification**

  Run: `python tests/live_phase_check.py --port 3543 --phase 4`

  Expected: the live check uses the isolated scratch database path and reports the expected phase-4 health without changing the real database.

- [ ] **Step 5: Run the catalog validator**

  Run: `python C:\Users\Prime Steel\.gemini\antigravity\scratch\tally_vs_independent_books\verify_catalog.py`

  Expected: all catalog entries pass.

- [ ] **Step 6: Review the final diff and status**

  Run: `git status --short; git diff --stat; git diff --check`

  Expected: only intended implementation, test, and documentation files are changed; no real database or native Tally files are modified.
