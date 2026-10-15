# Phase 4 Reporting and Drill-Down Implementation Plan

> **For agentic workers:** Execute task-by-task with test-driven development and run the final full verification gate.

**Goal:** Add condensed/detailed financial trees, side-by-side comparison
columns, and period-safe multi-tier drill-down.

**Architecture:** Python produces immutable report snapshots with node IDs,
period IDs and leaf totals. JavaScript renders those nodes and carries a typed
drill context in the existing route stack. No report derives a child total by
re-summing a displayed parent plus its children.

**Spec:** `../specs/2026-10-11-accounting-workflows.md`

## Files

- Create: `tests/test_phase4_reports.py`, `tests/test_phase4_browser.py`.
- Modify: `books.py`, `app_server.py`, `workflows.js`, `voucher_logic.js`,
  `fidelity.css`, and documentation for report routes.

## Interfaces

- `financial_tree(company, report, period, detailed=False) -> ReportSnapshot`.
- `compare_periods(company, report, periods) -> {'columns': [...], 'rows': [...]}`.
- `drill_context(node) -> {company, report, period, node_type, node_id}`.
- `renderFinancialTree(snapshot, detailed)` and `renderComparison(snapshot)`.

## Task P4.1: Recursive trees and leaf-safe totals

**Test first:** nested groups expand under Alt+F1/Alt+F5, condensed totals equal
leaf sums, repeated toggles are idempotent, and no parent is counted twice.

- Run red Python/browser tests.
- Add recursive group tree with cycle guard and stable node IDs; derive Balance
  Sheet/P&L rows from the selected immutable view.
- Bind Alt+F1 and Alt+F5 in financial reports; preserve the chosen mode on frame
  and render accessible expand/collapse controls.
- Run focused and full suite.

## Task P4.2: Comparison columns

**Test first:** Q1/Q2 and month-on-month columns have independent openings,
movements and closings; empty periods are zero; period order and labels survive
navigation; one snapshot revision is used.

- Run red tests.
- Add comparison query parameters/route and period selector dialog. Validate
  non-overlapping/in-range dates and avoid hidden current-date defaults.
- Render amount columns with no change to existing single-period reports.
- Run focused/browser tests.

## Task P4.3: Deep drill chain and stale refresh

**Test first:** click figure through Group Summary, Ledger Monthly Summary,
Voucher Register and Alteration; assert every request carries company/period;
altering a voucher refreshes each ancestor and preserves the correct period.

- Run red browser/API tests.
- Add typed row actions and carry `drill_context` through `navigate`. Replace
  free-text ambiguous `groupReport`/`ledgerReport` args where context exists.
- Ensure calculated Closing Stock/Profit rows route to their actual contributing
  reports and not synthetic ledger names.
- After successful alteration, refresh current snapshot and rebuild ancestors;
  invalid context returns a visible error without changing books.
- Run final gate and catalog validator.

## Phase 4/final gate

```powershell
$env:PYTHONPATH='C:\Users\PRIMES~1\AppData\Local\Temp\omnirush\ib-browser-deps'; $env:NODE_OPTIONS=''
python -m pytest tests -q
python tests/live_phase_check.py --port 3543 --phase 4
python C:\Users\Prime Steel\.gemini\antigravity\scratch\tally_vs_independent_books\verify_catalog.py C:\Users\Prime Steel\.gemini\antigravity\scratch\tally_vs_independent_books\discrepancies_catalog.json --final --markdown C:\Users\Prime Steel\.gemini\antigravity\scratch\tally_vs_independent_books\tally_vs_independent_books_1000_details.md
```
