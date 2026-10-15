# Phase 4 verification: reporting and drill-down

Date: 2026-10-12

## Implemented scope

- Immutable financial report snapshots with company, revision, period ID, node
  IDs, typed node kinds, context tokens, and recursive group trees.
- Condensed/detailed financial tree rendering with Alt+F1/Alt+F5 behavior.
- Leaf-safe totals that do not count parent groups twice.
- Period movement, opening, and closing values for comparison columns.
- Comparison validation for unique, non-overlapping, in-year periods and zero
  values for empty periods.
- Period-safe drill context through group summary, ledger monthly summary,
  voucher register, and voucher alteration routes.
- Calculated Closing Stock and Profit & Loss rows with explicit drill targets.
- Financial tree and comparison REST endpoints.
- Renamed system-group preservation through report classification metadata.

## Automated checks

With browser dependencies enabled:

```powershell
$env:PYTHONPATH='C:\Users\Prime Steel\AppData\Local\Temp\omnirush\ib-browser-deps'
$env:NODE_OPTIONS=''
python -m pytest tests -q
```

Result: **53 passed**, 0 failed, 0 skipped.

Focused checks:

- `python -m pytest tests/test_phase4_reports.py -q`: **8 passed**.
- `python -m pytest tests/test_phase4_browser.py -q`: **2 passed**.
- Python compilation and JavaScript syntax checks passed.
- Existing Node rules: **6 assertions passed**.
- Phase 1 Node rules: **23 assertions passed**.

## Isolated live-server gate

Executed against the isolated scratch database:

```powershell
python tests/live_phase_check.py --port 3543 --phase 4
```

Result: `independent=true`, `data_path=...\tests\scratch_books.sqlite3`,
`revision=52`, `voucher_count=1`, and `report_snapshot=true`.

The original service was restored afterward and again reports the correct
application root and real data path.

## Catalog validation

The required final catalog validator passed all **1,200** entries and all
Markdown synchronization checks.

## Release boundary

All four implementation phases now have isolated automated and scratch-server
coverage. The real database remains an actively changing user datastore; its
static export digest is therefore an open operational-baseline item. No real
database rollback or overwrite was performed.
