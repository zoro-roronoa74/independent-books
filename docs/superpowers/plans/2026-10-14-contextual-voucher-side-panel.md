# Contextual Voucher Side Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace voucher modal/inline master lookup with a contextual Tally-style side panel that filters valid masters, supports contextual creation, and keeps Enter/Ctrl+A save behavior identical.

**Architecture:** Add a dependency-free pure JavaScript lookup-context module for classification, filtering, searching, ordering, and Create metadata. Integrate it into the existing `#keys` function-key area as a voucher-only panel, while preserving the existing modal implementation for non-voucher screens and master forms. Keep posting, validation, GST, inventory, bill allocation, and billing formulas on their existing server/client paths.

**Tech Stack:** Browser JavaScript, existing HTML/CSS, Playwright via pytest, Node `assert/strict`, existing Python local server and temporary SQLite fixtures.

**Spec:** `docs/superpowers/specs/2026-10-14-contextual-voucher-side-panel-design.md`

## Global Constraints

- Native TallyPrime executable, local Tally services, proprietary Tally data files, and ports `9000`/`9999` are not launched, accessed, or modified.
- Filtering uses effective `system_group` classifications and `group_records`/`parent` ancestry; it must not assume `root_group` alone equals a Tally user-facing group.
- The panel must never broaden an unresolved context to all ledgers or all masters.
- Existing server validation and posting remain authoritative.
- Voucher creation through the panel must preserve the unfinished draft and return to the exact originating field and row.
- Final bottom-ledger Enter and Ctrl+A must call the same immediate save path.
- Existing non-voucher modal lookups and function-key behavior must continue to work.
- Tests use temporary databases or `tests/scratch_books.sqlite3`, never the active real database.

## Review Focus

- Renamed or nested debtor/creditor groups: classification must follow `system_group` and ancestry, not only the visible parent name. Test in Task 1.
- Payment/receipt party versus bank/cash overlap: neither list may contain the other context's ledgers. Test in Task 1 and Task 4.
- Empty and zero-result contexts: the panel must remain usable and preserve a valid contextual Create action. Test in Task 2.
- Draft return after contextual creation: a second item or additional-ledger row must retain earlier values and focus the exact origin. Test in Task 3.
- Final Enter versus Ctrl+A: both must post once, validate identically, and never append an unintended row. Test in Task 4.

---

### Task 1: Pure contextual lookup resolver

**Files:**
- Create: `lookup_context.js`
- Modify: `index.html:10` to load `lookup_context.js` before `workflows.js`
- Create: `tests/test_contextual_lookup.js`
- Modify: `tests/test_client_rules.py` to run the new Node test

**Interfaces:**
- Consumes: `data.ledgers`, `data.group_records`, `data.stock_items`, `data.stock_groups`, `data.stock_categories`, voucher base type, field name, row context, and selected value.
- Produces:
  - `lookupContext(data, {base, field, rowType, selected, accountName, partyName}) -> Context`
  - `lookupOptions(data, context, query) -> Array<{name, value, detail, selected}>`
  - `effectiveSystemGroup(data, groupName) -> string`
  - `context.create -> {kind, parent, label}`
  - `window.IndependentLookupContext` and CommonJS exports for tests.

- [x] **Step 1: Write failing resolver tests**

  Add fixtures with:
  - `Sundry Debtors` classified under `Current Assets` and a nested custom debtor group.
  - `Sundry Creditors`, nested sales/purchase groups, expense/income groups, bank/cash groups, unrelated ledgers, and stock items.
  - A renamed/nested group whose `system_group` retains the Tally classification.

  Assert:
  - Sales party returns debtor descendants only.
  - Purchase party returns creditor descendants only.
  - Sales/Purchase account returns only the matching nominal classification.
  - Additional ledgers return all four expense/income classifications and exclude party, account, cash/bank, tax, and stock items.
  - Payment/receipt bank/cash and party options are disjoint.
  - Item context returns stock items only.
  - Journal/Contra ledger context returns accounting ledgers only.
  - Results are stable-sorted, query-filtered by name/alias/group text, and put the selected value first.
  - Create labels/parents match each context.

- [x] **Step 2: Run the resolver test and confirm a feature-specific failure**

  Run:

  ```powershell
  node tests/test_contextual_lookup.js
  ```

  Expected: FAIL because `lookup_context.js` and the exported resolver do not yet exist.

- [x] **Step 3: Implement the pure resolver**

  Implement effective classification by walking `group_records` and `parent` links with a visited set. Prefer a group record's `system_group`, then a recognized system group name, and stop safely at `Primary`. Keep the resolver independent of DOM and posting code.

- [x] **Step 4: Run the resolver test and the existing JavaScript checks**

  Run:

  ```powershell
  node tests/test_contextual_lookup.js
  node tests/test_voucher_logic.js
  node tests/test_phase1_logic.js
  ```

  Expected: all commands exit 0.

- [x] **Step 5: Commit the pure resolver**

  ```powershell
  git add lookup_context.js index.html tests/test_contextual_lookup.js tests/test_client_rules.py
  git commit -m "feat: add contextual voucher lookup resolver"
  ```

  If Git is unavailable in this workspace, record that fact and continue without changing repository configuration.

### Task 2: Voucher-aware side panel rendering

**Files:**
- Modify: `workflows.js:6,33-55,197-206,315-445`
- Modify: `fidelity.css` side-panel and selected-row rules
- Create: `tests/test_contextual_lookup_browser.py`

**Interfaces:**
- Consumes: `window.IndependentLookupContext`, existing `state.data`, `state.draft`, and voucher form controls.
- Produces:
  - `state.lookup` transient state.
  - `voucherLookupTarget(control) -> target metadata or null`.
  - `renderVoucherLookup(control) -> void`.
  - `selectVoucherLookup(value) -> void`.
  - A panel rendered inside `#keys` with a context title, search input, options, empty state, Create action, and preserved function-key buttons.

- [x] **Step 1: Write failing browser tests for automatic panel behavior**

  Add an isolated Playwright fixture or reuse `tests/test_browser_vouchers.py:app` and assert:
  - Opening Sales, Purchase, Payment, Receipt, Journal, and an inventory voucher shows `#keys .voucher-lookup-panel`.
  - The panel's first context is the voucher's first logical field.
  - `#overlay` is hidden while the voucher panel is active.
  - Focusing party, account, item, payment bank, payment party, and additional-ledger controls updates the title and options without opening a modal.
  - Function-key buttons remain present.
  - Zero results show an empty state and retain a contextual Create button.

- [x] **Step 2: Run only the new browser tests and confirm they fail**

  Run:

  ```powershell
  pytest -q tests/test_contextual_lookup_browser.py
  ```

  Expected: FAIL because `#keys` currently contains only function-key buttons and no voucher lookup panel.

- [x] **Step 3: Implement panel state and rendering**

  Add a voucher-only branch to `setKeys()`/`render()` that renders lookup controls before the function-key buttons. Re-render options on query input and focus changes. Use event delegation for panel rows and a visible selected class. Keep `choose()` and `chooseSelect()` unchanged for reports, company dialogs, and master forms until their voucher call sites are removed.

- [x] **Step 4: Wire focus to `renderVoucherLookup()`**

  Register a capture-phase focus handler for active voucher selection controls. Resolve the target context from base type, control name, and row class. Do not show a generic all-ledger list when target resolution fails; show an explicit empty state.

- [x] **Step 5: Run the focused browser tests**

  Run:

  ```powershell
  pytest -q tests/test_contextual_lookup_browser.py
  ```

  Expected: panel, context changes, overlay state, empty state, and preserved shortcuts pass.

### Task 3: Remove inline voucher creation and connect contextual creation

**Files:**
- Modify: `workflows.js:79-85,198-206,283-290,318-320,427-445`
- Modify: `tests/test_browser_vouchers.py` existing inline-creation test and new contextual-creation cases
- Modify: `fidelity.css` to hide/remove obsolete `.inline-ledger` styling from voucher flows

**Interfaces:**
- Consumes: `state.lookup.create`, the existing master form route, and the existing `frame().inlineReturn` draft-preservation mechanism.
- Produces: contextual Create action that opens the correct ledger or stock-item master, preserves row index/field name, refreshes data, and returns to the exact originating field.

- [x] **Step 1: Write failing creation/removal browser tests**

  Assert:
  - No visible `.inline-ledger` or `+ Ledger`/`+` master button exists on Sales, Purchase, accounting, inventory, Payment, or Receipt voucher screens.
  - Sales party Create opens a ledger master with parent `Sundry Debtors`.
  - Purchase account Create opens a ledger master with parent `Purchase Accounts`.
  - Item Create opens a stock-item master.
  - Creating a master from the second additional-ledger row or second item row returns to that exact row, selects the new master, refreshes the panel, preserves previous values, and does not post the voucher.
  - Canceling creation returns to the same field and context.

- [x] **Step 2: Run the new creation tests and confirm they fail**

  Run:

  ```powershell
  pytest -q tests/test_contextual_lookup_browser.py -k "create or inline"
  ```

  Expected: FAIL because voucher renderers still emit inline buttons and the panel has no Create action.

- [x] **Step 3: Remove voucher inline buttons without changing master-form controls**

  Make `ledgerField()`, `ledgerSelect()`, and item-row rendering return plain controls. Remove voucher `data-action="inlineLedger"`/`inlineStock` buttons and the voucher `setKeys()` Create Ledger shortcut. Keep Alt+C as a compatibility route only if it delegates to the current field's contextual Create action; do not expose it as a visible inline button.

- [x] **Step 4: Implement contextual Create return**

  Extend `openInlineMaster()` or replace it with a context-aware helper that receives the lookup target, derives ledger parent/stock-item parent, records `{field,index,kind,context}`, and uses the existing master form route. On save/cancel, restore the frame and refresh the correct panel; never broaden the list to all masters.

- [x] **Step 5: Run creation and existing voucher regressions**

  Run:

  ```powershell
  pytest -q tests/test_contextual_lookup_browser.py tests/test_browser_vouchers.py::test_inline_creation_returns_to_second_ledger_row_and_preserves_draft
  ```

  Expected: the new contextual creation tests pass; the existing test is updated to the supported panel path and still verifies draft preservation.

### Task 4: Keyboard navigation, sequential entry, and final save parity

**Files:**
- Modify: `workflows.js:344-389`
- Modify: `tests/test_contextual_lookup_browser.py`
- Modify: `tests/test_phase1_browser.py` only where existing Enter/Ctrl+A expectations describe the old inline/modal flow

**Interfaces:**
- Consumes: `state.lookup`, panel option rows, `focusNextControl()`, `accept(true)`, `ensureInvoiceRow()`, and existing allocation handling.
- Produces: mouse selection, Arrow Up/Down cursor movement, Enter selection/advance, Escape close-without-discard, item sequence navigation, explicit Add Ledger Row behavior, and identical final Enter/Ctrl+A save.

- [x] **Step 1: Write failing keyboard and save-parity browser tests**

  Assert:
  - Search matches item name, ledger alias, and group text.
  - Arrow keys move the panel highlight without changing the voucher until Enter.
  - Enter on a highlighted party/account/item advances to the next logical control and changes the panel context.
  - Mouse selection has the same result as Enter selection.
  - Escape closes only lookup selection and keeps the draft.
  - Item sequence is item → quantity → alternate quantity when configured → rate → amount → next row.
  - Enter on a completed final extra-ledger amount calls immediate save instead of appending a row.
  - Ctrl+A on the same completed draft posts identical canonical data.
  - Invalid drafts fail identically through both paths and leave the database unchanged.
  - An explicit Add Ledger Row control appends a row without posting.

- [x] **Step 2: Run the keyboard tests and confirm the expected failures**

  Run:

  ```powershell
  pytest -q tests/test_contextual_lookup_browser.py tests/test_phase1_browser.py -k "lookup or Enter or save or row"
  ```

  Expected: failures identify the current modal re-focus behavior and `ensureExtraLedgerRow()` behavior that appends instead of saving.

- [x] **Step 3: Implement panel keyboard/mouse behavior**

  Route panel events before the generic form key handler. Arrow keys update `state.lookup.cursor`; Enter invokes `selectVoucherLookup()`; Escape clears only lookup state; panel click selects and advances. Ensure the event is consumed once so generic form navigation cannot run twice.

- [x] **Step 4: Implement sequential item navigation**

  Make the logical control order follow the active billing profile. Preserve hidden controls and server-side billing calculation. When a completed item amount is entered, append/focus the next item row through the existing `ensureInvoiceRow()` path; do not alter item posting semantics.

- [x] **Step 5: Split explicit row addition from final save**

  Add a visible `Add Ledger Row` action for `#extra-table`. Change the completed final extra-ledger amount Enter path to call `accept(true)` after allocation handling rather than `ensureExtraLedgerRow()`. Keep Ctrl+A mapped to `accept(true)`. Use one helper, for example `acceptImmediateVoucher()`, only if it reduces duplicate logic; both routes must end at `accept(true)`.

- [x] **Step 6: Run focused keyboard and save tests**

  Run:

  ```powershell
  pytest -q tests/test_contextual_lookup_browser.py tests/test_phase1_browser.py -k "lookup or Enter or save or row"
  ```

  Expected: all focused contextual keyboard, item sequence, explicit-row, and save-parity tests pass.

### Task 5: Regression integration and accessibility polish

**Files:**
- Modify: `workflows.js`, `fidelity.css`, `index.html` only as needed by Tasks 1–4
- Modify: `tests/test_browser_vouchers.py`, `tests/test_phase1_browser.py`, and any existing JavaScript test touched by the implementation
- Modify: `docs/verification/tally-voucher-billing.md` with the new checks and native-runtime limitation

**Interfaces:**
- Consumes: completed resolver, side panel, creation lifecycle, and keyboard paths.
- Produces: a stable application flow across all voucher bases without regressions in existing billing, GST, inventory, allocation, print, import, or reports.

- [x] **Step 1: Add regression assertions for all voucher bases**

  Cover Sales, Purchase, Credit Note, Debit Note, Payment, Receipt, Contra, Journal, Stock Journal, and Physical Stock where the existing app supports those screens. Assert correct empty/creation states for unsupported or non-accounting fields.

- [x] **Step 2: Add accessibility and visual behavior assertions**

  Assert the panel has a labelled search input, selected option state, keyboard-visible cursor, button labels, no hidden modal behind an active panel, and no horizontal overflow at the existing 1440×1000 fixture viewport.

- [x] **Step 3: Run the smallest complete browser regression set**

  Run:

  ```powershell
  pytest -q tests/test_contextual_lookup_browser.py tests/test_browser_vouchers.py tests/test_phase1_browser.py tests/test_billing_settings_browser.py tests/test_print_browser.py
  ```

  Expected: all selected browser tests pass with no page errors.

- [x] **Step 4: Run JavaScript syntax and rule checks**

  Run:

  ```powershell
  node --check lookup_context.js
  node --check workflows.js
  node tests/test_contextual_lookup.js
  node tests/test_voucher_logic.js
  node tests/test_phase1_logic.js
  node tests/test_date_picker.js
  node tests/test_print_view.js
  ```

  Expected: every command exits 0.

### Task 6: Full verification and review

**Files:**
- Review only: all files changed by Tasks 1–5
- Modify: `docs/verification/tally-voucher-billing.md` if evidence or limitations need correction

- [x] **Step 1: Run the complete project test suite**

  Run:

  ```powershell
  pytest -q
  ```

  Expected: zero failures and no unreported page errors.

- [x] **Step 2: Run syntax and repository checks**

  Run:

  ```powershell
  python -m compileall -q .
  node --check lookup_context.js
  node --check workflows.js
  graft check
  ```

  Expected: all commands exit 0. If `graft check` reports stale generated cards, refresh only through the documented graft command and rerun it.

- [x] **Step 3: Perform a manual isolated live phase check**

  Start the local service against `tests/scratch_books.sqlite3` on an unused port, exercise Sales and Payment lookup, create one contextual master, save one voucher with final Enter, and verify the saved voucher through the temporary database. Do not use the real service or real database.

- [x] **Step 4: Review the final diff and evidence**

  Since this workspace is not currently a Git repository, inspect changed files directly and run the project's available diff/status equivalent if one is added later. Confirm no native Tally process, port, protected file, credential, or real database was accessed.

- [x] **Step 5: Report actual results**

  Report changed files, exact commands, pass/fail counts, any unavailable checks, and the native-runtime limitation. Do not claim native Tally verification.

## Self-review

- **Spec coverage:** Tasks 1–4 cover resolver/filtering, panel display, inline-button removal, contextual creation, keyboard/mouse selection, field transitions, item sequence, explicit row creation, and final Enter/Ctrl+A parity. Task 5 covers regression and accessibility requirements. Task 6 covers evidence and safety boundaries.
- **Step scan:** Each task separates red test, expected failure, minimal implementation, focused verification, and broader regression. Interfaces name the functions and data each later task consumes.
- **Type consistency:** The resolver exports `lookupContext`, `lookupOptions`, and `effectiveSystemGroup`; the panel consumes the returned `context.create`, `options`, and `selected` fields. The plan intentionally keeps DOM integration out of the pure module.
- **Review focus:** Nested classification, disjoint payment contexts, zero-result creation, exact draft return, and final-save parity each have explicit tests in their owning tasks.
- **Proportion:** The plan adds implementation decisions and test boundaries without reproducing the application body; it follows the current large-file architecture rather than performing an unrelated refactor.
