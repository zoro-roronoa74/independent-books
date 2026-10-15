# Independent Books: four-phase workflow specification

Status: approved implementation contract for the user's `/goal` request.
Root: `C:\Users\Prime Steel\AppData\Local\Programs\IndependentBooks`.

## Goal and acceptance boundary

Deliver, in order, (1) keyboard-first voucher mechanics, (2) multi-bill allocations
and ageing, (3) warehouse/batch inventory with compound units and FIFO, and
(4) hierarchical, comparative financial reports with complete drill-down.
Each phase must pass its full automated suite and the real scratch-server/API
gate before the following phase starts. This is not acceptance of all 1,200
catalog discrepancies or proof of complete native Tally parity.

The user's feature descriptions govern scope. The supplied catalog is a
reference, with mismatched IDs recorded rather than silently relabelled:

| Requested label | Catalog observation actually found |
|---|---|
| GAP-0481: tri-mode | GAP-0481 is F4-F9 navigation; tri-mode/preservation is GAP-0483-0485 |
| GAP-0498: repeat narration | GAP-0498 is consignee details; narration is GAP-0172 / GAP-0537 |
| GAP-0604: allocation popup | GAP-0604 is stock category reporting |
| GAP-0622: compound units | Compound unit creation is GAP-0607; quantity notation is GAP-0608 |
| GAP-0721-0735: four methods | This range includes bill settings, credit limits and opening bills |

Do not implement unrelated features solely to satisfy these inconsistent IDs.
`verify_catalog.py` validates schema, counts, references and Markdown IDs, not
the truth of the native UI observations or runtime behavior.

## Existing architecture and compatibility

- Python standard library HTTP server; vanilla JavaScript DOM; SQLite `state`
  and `history` tables containing version-1 JSON. Keep these tables and history.
- Positive signed amounts mean debit internally; negative Tally `AMOUNT`
  with `ISDEEMEDPOSITIVE=Yes` means debit in exported voucher entries.
- Keep `Books.post_voucher(company, voucher) -> str` and existing REST response
  fields. Add optional fields/endpoints, never replace stored company payloads.
- Preserve voucher IDs/GUIDs, unknown imported fields, raw XML and allocations.
  Read-only views and previews must not increment the revision or write books.
- Additive metadata uses optional `BOOKSENTRYMODE`, `BOOKSEDITOR`, allocation
  and unit attributes. Backup `version` remains 1; absent additions have legacy
  defaults. Any needed migration is idempotent and transactional.
- Extend `interchange.py` only for new metadata round-trips/validation. It is a
  necessary boundary even though it is not in the user's five primary files.
- Pytest, Playwright and Node are development tools only, not app dependencies.
  The app remains offline and retains the light-green theme.

## Phase 1: interaction contract

- Ctrl+H opens the three choices in Sales/Purchase: Item Invoice, Accounting
  Invoice, As Voucher. One canonical draft with stable line IDs owns raw input
  strings, incomplete lines, common headers, allocations and posting roles.
  Changing view does not post, erase, duplicate or round values.
- Accounting Invoice supports service ledgers and per-line GST, without fake
  stock items. An item invoice projected into Accounting Invoice keeps its stock
  detail and references item-derived posting rows; returning restores every item.
  As Voucher permits explicit postings. Switching back retains manual postings;
  an unrepresentable posting stays visible as an additional ledger, not dropped.
- Alt+C on a ledger or item selector, including its open lookup, opens a nested
  master modal. Save returns to that exact stable line/field; Esc unwinds one
  modal. Duplicate/invalid master saves retain the voucher and entered master.
- Ctrl+R in narration retrieves the most recently saved effective, non-empty
  narration for the exact voucher type and company, excluding the voucher being
  altered. It is independent of the report's period. No match leaves text intact.
- Ctrl+N opens/focuses a bottom calculator; Ctrl+M or Esc from the calculator
  restores the originating field. Evaluate arithmetic with parentheses, unary
  signs, +, -, *, / and postfix `%` = divide by 100. `2500*18%` equals `450`.
  Use a parser, not `eval` or `Function`; reject malformed input/division by zero.
- Enter advances within the active form/modal, validates required input, and
  retains the blank-item-row transition to charge rows. Backspace in voucher or
  master fields moves to the preceding field without deleting text. Delete
  remains text editing; lookup-search and calculator retain normal Backspace.
- Ctrl+A immediately validates and saves the current form/modal with no Accept
  confirmation. It never posts a parent voucher while a child modal is active.
  Pending-save locking prevents repeated keystrokes from creating duplicates.

## Phase 2: allocation contract

- Selecting a debtor/creditor in Payment, Receipt or an invoice opens bill
  allocation, with editable amount if the voucher amount is not known yet.
  Reopen after changing amount; do not silently scale existing splits.
- New Ref records name, invoice date, due date and amount. Agst Ref selects
  pending bills by stable ID, supports partial amounts against multiple bills,
  and prevents wrong-party, future, stale or excessive settlements at commit.
- Advance retains named advance amount and explicitly entered tax-tracking
  components. Tax metadata does not automatically create extra postings or
  assert tax applicability; included tax postings must reconcile to gross cash.
- On Account records an explicit unassigned residual. Chosen allocations must
  sum to the entry's amount; no hidden residual or automatic overpayment.
- Preserve legacy name-only references. Resolve unique company/ledger/name
  matches; ambiguous legacy references remain identified rather than merged.
- Rebuild balances from opening amounts and all effective transactions through
  the as-of date, not just the visible period. Alterations exclude the old voucher
  while calculating available bills. Cancelling settlements restores outstandings.
- Ageing uses elapsed days from invoice date by default, with a selectable
  due-date basis. Buckets are `<30` (0-29), `30-60` (30-59), `60-90` (60-90),
  `>90` (91+). Not-yet-due bills are separate in due-date mode. Missing legacy
  dates are Unallocated/Undated, never invented dates in a numeric age bucket.

## Phase 3: inventory contract

- Item selection opens an allocation modal for godown, batch/lot, expiry,
  quantity, unit, rate and per-unit denominator. Multiple allocations sum to
  the item's base quantity and amount. Esc cancels without mutating the row.
- Keep legacy unallocated stock in Main Location / blank batch; explicitly
  supplied locations remain separate. Validate expiry format and location IDs.
- Compound unit records add `type`, `base_unit`, and decimal-string `factor`:
  Box -> Nos, factor 10 means 1 Box = 10 Nos. Convert both quantity and rate,
  check dimensions/cycles and preserve original display units on each line.
- Moving Average remains the default. FIFO is a stock-item setting using
  chronological layers within item/godown/batch. Views rebuild deterministically;
  no mutation of historical vouchers or unrelated companies.
- Company `negative_stock_policy` supports `warn` (default) and `block`.
  Warn returns a structured preview/commit warning; explicit Continue permits
  that particular candidate/revision. Cancel leaves no posting. Recheck stock
  inside the posting transaction; stale acknowledgement is invalid.
- A warned short issue uses last known cost for the shortage (zero only when
  no cost history exists, labelled provisional). Subsequent receipts clear the
  short quantity first and replace provisional cost with receipt cost through
  deterministic replay; earlier as-of reports remain based on then-known data.

## Phase 4: reports contract

- Alt+F1 and Alt+F5 toggle condensed/detailed Balance Sheet and P&L. Detailed
  groups recursively expand to ledgers; totals count leaves once, not both
  parent totals and children. Preserve renamed system-group classifications.
- Comparison supports explicit periods and month/quarter generation. Each
  column computes its own opening, movement and closing, under one snapshot
  revision. Empty periods display zero movement rather than missing columns.
- Every ledger/group figure carries its own company, period and ID into the
  drill chain: Financial report -> Group Summary -> Ledger Monthly Summary ->
  Voucher Register -> Voucher Alteration. A period column cannot open a different
  period's vouchers. Esc restores columns, expansion, scroll and cursor.
- Closing stock and profit total rows open their contributing stock/P&L detail
  instead of fabricating an accounting ledger for a calculated number.
- Saving an alteration refreshes affected ancestor figures; no stale-cache totals.

## Verification and release

Run exactly `python -m pytest tests -q` with all browser dependencies available
and no skipped feature tests. Also run JavaScript tests through a pytest wrapper.
For each phase run `python app_server.py --port 3543 --data tests/scratch_books.sqlite3`
and assert the reported absolute data path before creating/querying vouchers.
Use unique test-company names on repeat runs; preserve earlier scratch data.
Temporarily stop the identified working server through its shutdown endpoint,
then restore its original data path in a finally block after the gate.

Implementation status: Phases 1 and 2 are implemented and verified. Phases 3
and 4 are implemented with isolated automated suites and scratch-server gates;
the final release baseline remains open because the real database continues to
receive live user postings. Phase 2 added stable bill IDs, revision-safe
multi-bill allocation, pending/ageing APIs and reports, nested bill-wise entry,
tactile date/amount parsing, and live two-column master pickers. Phase 3 adds
godown/batch/expiry allocation, compound units, FIFO layers, and structured
negative-stock warning acknowledgement. Phase 4 adds recursive financial
trees, comparison periods, calculated-row drill targets, and typed period-safe
contexts. The catalog's 1,200 entries passed its structural validator.
