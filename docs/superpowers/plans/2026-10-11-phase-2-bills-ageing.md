# Phase 2 Bills and Ageing Implementation Plan

> **For agentic workers:** Execute task-by-task with test-driven development and run the phase gate before Phase 3.

**Goal:** Replace one-reference bill entry with safe multi-bill allocation and
an ageing report while retaining all legacy references.

**Architecture:** Add pure allocation/ageing functions to `books.py`; expose
read-only pending-bill data and a commit endpoint that passes expected revision
and stable bill IDs. Render allocation as a nested voucher dialog, then add a
report route using the same calculated snapshot.

**Spec:** `../specs/2026-10-11-accounting-workflows.md`

## Files

- Create: `tests/test_phase2_bills.py`, `tests/test_phase2_browser.py`.
- Modify: `books.py`, `app_server.py`, `workflows.js`, `voucher_logic.js`,
  `fidelity.css`, `interchange.py` for allocation metadata round-trip.

## Interfaces

- `Books.pending_bills(company, ledger, as_of=None) -> list[dict]` with stable
  `bill_id`, name, date, due_date, original, pending, and party.
- `Books.allocate_bill_lines(company, ledger, amount, method, allocations,
  expected_revision) -> dict` returning normalized allocations and residual.
- `Books.ageing(company, ledger=None, as_of=None, basis='due_date') -> dict`
  with `buckets`, `rows`, and `undated`.
- `normalizeAllocation(method, amount, rows) -> AllocationResult` in JS.

## Task P2.1: Stable bills and allocation engine

**Test first:** New Ref, Agst Ref multi-partial, Advance, On Account; over-allocation,
wrong party, stale revision, cancelled bill, and exact residual tests.

- Run focused Python tests; expected red.
- Extend `_rebuild` bill records with deterministic IDs derived from ledger,
  reference and source voucher identity; preserve existing names. Capture
  `BILLDATE`, `DUEDATE`, `CREDITPERIOD` where present, with blank/undated safe.
- Implement pending calculation from opening and effective vouchers, excluding
  the voucher under alteration. Do not mutate state from a preview.
- Validate expected revision inside `Books.transaction`; reject stale writes and
  any allocation whose absolute sum exceeds the entry amount. Commit allocation
  records with method and metadata.
- Run focused tests and existing suite.

## Task P2.2: REST boundary and allocation dialog

**Test first:** API preview returns the correct party and pending bills without
  changing revision; commit returns normalized allocations; invalid request is
  400/409 and leaves export digest unchanged.

- Run red API/browser tests.
- Add `GET /api/pending_bills`, `POST /api/preview_allocations`, and include
  allocation data in voucher create/alter without breaking current endpoints.
- Add `allocationDialog()` with method-specific controls, multi-select partial
  amounts, exact remaining amount, and explicit Continue/Cancel.
- Wire Payment, Receipt and invoice party changes to open it; keep On Account
  default only when no bills exist. Esc must not lose the voucher draft.
- Run focused browser and Python tests.

## Task P2.3: Ageing report

**Test first:** Hand-derived bills at 10, 30, 60, 90, 91 days and undated are
  bucketed correctly for invoice-date and due-date basis; report click opens the
  party ledger with the same as-of date.

- Run red tests.
- Add `ageing` data route and `renderReport` branch for `Outstanding Bills`.
  Add `Outstandings -> Ageing` menu entry and basis/as-of controls.
- Add stable row actions and API/browser assertions for buckets and drill-down.
- Run phase gate, full suite, and restore original server.

## Phase 2 gate

```powershell
$env:PYTHONPATH='C:\Users\PRIMES~1\AppData\Local\Temp\omnirush\ib-browser-deps'; $env:NODE_OPTIONS=''
python -m pytest tests -q
python tests/live_phase_check.py --port 3543 --phase 2
```
