# Phase 1 Voucher Mechanics Implementation Plan

> **For agentic workers:** Execute task-by-task with test-driven development. Each task starts with a failing test, then minimal implementation, then focused and full verification.

**Goal:** Add safe tri-mode voucher drafts, inline master creation, repeat narration, calculator, and Tally-style keyboard traversal without losing entered data.

**Architecture:** Add pure draft/projection/calculator helpers to `voucher_logic.js`
and let `workflows.js` render from one draft object. Add small Books query helpers
for narration and mode metadata; REST only supplies data needed by the client.

**Spec:** `../specs/2026-10-11-accounting-workflows.md`

## Files

- Create: `tests/test_phase1_books.py`, `tests/test_phase1_logic.js`.
- Modify: `books.py` (narration lookup, additive mode defaults, validation for
  optional mode metadata), `app_server.py` (narration endpoint), `workflows.js`
  (draft/mode/modal/key handlers), `voucher_logic.js` (pure safe calculator and
  mode/draft helpers), `fidelity.css` (calculator/mode/modal styles).
- Modify: `tests/test_browser_vouchers.py` only after the red tests pin the new
  Ctrl+A behavior; do not hide old test failures.

## Interfaces

- `Books.last_narration(company: str, voucher_type: str, exclude_master_id: str | None = None) -> str`.
- `Books.voucher_mode_defaults(company: str, voucher_type: str) -> dict` returns
  `{'mode': 'invoice', 'accounting_mode': 'accounting_invoice'}` with absent
  metadata defaulting to current behavior.
- `safeCalculate(expression: str) -> {value: number, display: string}`.
- `preserveVoucherDraft(draft: object, targetMode: string) -> object`.
- `modeChoices(baseType: string) -> string[]`.
- `fieldTraversal(root: Element) -> Element[]`.

## Task P1.1: Backend narration and draft compatibility

**Test first:** `test_last_narration_uses_same_company_type_and_excludes_current`; 
`test_old_company_without_mode_metadata_gets_legacy_defaults`; `test_narration_endpoint_does_not_change_revision`.

- Run `python -m pytest tests/test_phase1_books.py -q`; expected red because
  the lookup and endpoint do not exist.
- Implement a read-only query over `all_vouchers`/`vouchers`, sorting by stable
  date/master order, filtering effective vouchers and non-empty `NARRATION`.
- Add `GET /api/last_narration?company=&voucher_type=&exclude=` with explicit
  company and JSON `{status:'success', narration:''}` on no match.
- Add `BOOKSENTRYMODE`/`BOOKSACCOUNTINGMODE` only when posted by the new UI;
  `data_view` supplies legacy defaults without persisting them.
- Run focused tests; expected pass. Verify no revision increment.

## Task P1.2: Pure client helpers, calculator, and modes

**Test first:** Node tests for safe arithmetic, percent precedence, malformed
input/division by zero, the three mode choices, and draft preservation with
incomplete item/ledger rows.

- Run `node tests/test_phase1_logic.js`; expected red.
- Implement a tokenizer/parser (numbers, parentheses, unary +/- and binary
  + - * /, postfix `%`) with finite-number checks; never use `eval`/`Function`.
- Implement mode projection as reversible metadata/projections, retaining raw
  `itemLines`, `ledgerLines`, `taxLines`, `headers`, `narration`, and `allocations`.
- Run the Node test and full existing client helper test; expected pass.

## Task P1.3: Render tri-mode and nested inline master creation

**Test first:** Browser test enters a Sales draft, adds an item and party, uses
Ctrl+H through all three modes and back, and asserts values/posting roles are
unchanged; Alt+C creates a stock item and ledger from the active row and returns
to the exact field; nested Esc returns to voucher.

- Run the new browser test; expected red against current two-mode/destructive
  `action('mode')` behavior.
- Replace `frame().mode` destructive toggle with draft mode selection. Render
  `Item Invoice`, `Accounting Invoice`, and `As Voucher`; do not call `render()`
  with a cleared draft. `collectVoucher` selects only the current posting
  projection while retaining other layers in raw metadata.
- Add Alt+C priority in `keydown` before generic Alt actions, but only for a
  ledger/stock selector or lookup search. Record `{kind,rowId,field}` in the
  modal frame. Use existing save endpoint and return with `refreshSelects()`.
- Add browser assertions for save payloads and no duplicated stock/tax rows.
- Run focused browser tests, then `python -m pytest tests -q`.

## Task P1.4: Keyboard traversal, narration, and calculator UI

**Test first:** Browser tests assert Enter advances, Backspace focuses previous
without changing value, Ctrl+A saves immediately, Ctrl+R calls narration API,
Ctrl+N opens/focuses calculator, `2500*18%` displays `450`, Ctrl+M/Esc restores
the originating control, and child modal Ctrl+A does not post the voucher.

- Run expected-red browser tests.
- Add a traversal event helper that ignores textarea editing, calculator input,
  lookup search and native text deletion. Use `preventDefault()` only for the
  handled shortcut. Backspace tests `selectionStart===selectionEnd===0` or a
  deliberately configured navigation chord before moving focus.
- Make Ctrl+A call `accept()` directly; remove confirmation for this path only.
- Add calculator strip to `index.html`, style in CSS, and maintain bounded
  history in state. No arbitrary code execution.
- Add Ctrl+R narration fetch and preserve typed text if no match/error.
- Run focused, full suite, compile and Node checks.

## Phase 1 gate

Run:

```powershell
$env:PYTHONPATH='C:\Users\PRIMES~1\AppData\Local\Temp\omnirush\ib-browser-deps'; $env:NODE_OPTIONS=''
python -m pytest tests -q
node tests/test_voucher_logic.js
node tests/test_phase1_logic.js
python tests/live_phase_check.py --port 3543 --phase 1
```

Expected: zero failures, zero skipped feature tests, scratch status path exact,
balanced test voucher retrievable by API, and the original server/data identity
restored after the gate.
