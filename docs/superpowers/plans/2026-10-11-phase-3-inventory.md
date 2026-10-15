# Phase 3 Inventory and Valuation Implementation Plan

> **For agentic workers:** Execute task-by-task with test-driven development and run the phase gate before Phase 4.

**Goal:** Add location/batch allocation, compound units, warning-based negative
stock handling, and deterministic FIFO alongside moving average.

**Architecture:** Normalize each inventory line into allocation records while
retaining the current simple line shape. Add unit conversion and valuation
functions as pure Decimal code; `_rebuild` consumes the normalized records and
company policy. UI uses a nested allocation dialog and an explicit warning
continuation tied to revision.

**Spec:** `../specs/2026-10-11-accounting-workflows.md`

## Files

- Create: `tests/test_phase3_inventory.py`, `tests/test_phase3_browser.py`.
- Modify: `books.py`, `app_server.py`, `workflows.js`, `voucher_logic.js`,
  `fidelity.css`, `interchange.py`.

## Interfaces

- `parse_compound_quantity(text, unit_record) -> Decimal`.
- `convert_quantity(quantity, from_unit, to_unit, units) -> Decimal`.
- `fifo_layers(company, item, godown, batch=None, as_of=None) -> list[dict]`.
- `value_stock_issue(layers, quantity, method='fifo') -> ValuationResult`.
- `Books.inventory_policy(company) -> {'negative_stock_policy': 'warn|block'}`.
- `Books.preview_inventory_posting(company, voucher) -> {'warnings': [...], 'valuation': ...}`.

## Task P3.1: Schema-compatible units and allocations

**Test first:** legacy flat units load unchanged; 1 Box = 10 Nos conversion,
cycle/dimension failures, quantity rounding, and allocation persistence across
backup/export/import.

- Run red Python and Node tests.
- Extend unit records with optional `type`, `base_unit`, `factor`, `decimals`,
  and item records with optional alternate unit. Normalize absent values to a
  simple factor-1 unit without rewriting old payloads.
- Add allocation records for godown/batch/expiry, validating IDs and decimal
  quantities. Keep blank legacy allocation as Main Location.
- Extend import/export safely and run all unit tests.

## Task P3.2: Godown/batch UI and arithmetic

**Test first:** selecting an item opens the allocation popup, multiple rows sum
  correctly, Esc restores the original row, compound quantity/rate displays and
  saves in base units, invalid expiry or mismatched dimensions is rejected.

- Run expected-red browser tests.
- Add `inventoryAllocationDialog()` and stable row IDs; do not use array indexes
  as identity after row removal. Update preview/collect code to use allocations.
- Add unit conversion helpers to `voucher_logic.js`; update rate calculation
  to base-unit amount while preserving display string.
- Run browser and full tests.

## Task P3.3: FIFO and shortage warnings

**Test first:** two receipts at different rates issue across layers with hand
  calculated FIFO value; moving average result remains unchanged; negative block
  rejects; warn previews, Continue posts, Cancel does not post; later receipt
  clears the provisional shortage layer.

- Run red Python/API/browser tests.
- Add optional `valuation_method` and `negative_stock_policy` company/item
  metadata. Implement Decimal FIFO layers sorted by date/master ID and a
  provisional shortage layer in replay state, without mutating historical rows.
- Add preview/commit REST endpoints carrying expected revision and warning token.
  Revalidate under transaction before posting.
- Add configuration controls and structured warning modal. Never silently
  turn a block into a warning.
- Run phase gate and restore original server.

## Phase 3 gate

```powershell
$env:PYTHONPATH='C:\Users\Prime Steel\AppData\Local\Temp\omnirush\ib-browser-deps'; $env:NODE_OPTIONS=''
python -m pytest tests -q
python tests/live_phase_check.py --port 3543 --phase 3
```
