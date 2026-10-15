# Phase 2 verification: bills and ageing

Date: 2026-10-12

## Implemented scope

- Stable bill IDs derived from ledger, reference and source voucher identity.
- Multi-bill `Agst Ref` allocation with partial settlement, duplicate-line
  aggregation, wrong-party/future/unknown reference rejection, and exact
  entry-total validation.
- `New Ref`, `Agst Ref`, `Advance`, and `On Account` metadata with explicit
  residuals and legacy name-only reference preservation.
- Revision-checked voucher posting and allocation preview/commit APIs.
- Read-only pending-bills and ageing REST routes.
- Invoice/payment bill-wise dialog with chained allocation entry, `Ctrl+A`
  child-modal acceptance, and no parent save while the child is active.
- Tactile date parser (`2`, `2.11`, `2.11.26`, `+`, `-`), amount shorthand
  (`k`, `l`, `c`/`cr`, and `=...` arithmetic), and two-column live master
  picker with a top `Create` row and balances/closing stock.
- Ageing screen with due-date/invoice-date basis, explicit boundaries,
  undated rows, not-yet-due rows, and ledger drill-down.
- XML and version-1 JSON backup round-trip of allocation and unknown metadata.

## Automated checks

Executed from the application root with browser dependencies enabled:

```powershell
$env:PYTHONPATH='C:\Users\PRIMES~1\AppData\Local\Temp\omnirush\ib-browser-deps'
$env:NODE_OPTIONS=''
python -m pytest tests -q
```

Result: **32 passed**, 0 failed, 0 skipped.

Additional checks:

- `python -m pytest tests/test_phase2_bills.py -q`: **10 passed**.
- `python -m pytest tests/test_phase2_browser.py -q`: **2 passed**.
- `node tests/test_voucher_logic.js`: **6 assertions passed**.
- `node tests/test_phase1_logic.js`: **21 assertions passed**.
- Python compilation checks passed for the modified application and Phase 2
  test modules.
- `node --check workflows.js` and `node --check voucher_logic.js` passed.

## Isolated live-server gate

The occupied port-3543 original service was identified by `/api/status`, its
real export was captured, and it was shut down through the identity-checked
shutdown endpoint. The scratch server was started against:

`C:\Users\Prime Steel\AppData\Local\Programs\IndependentBooks\tests\scratch_books.sqlite3`

Executed:

```powershell
python tests/live_phase_check.py --port 3543 --phase 2
```

Result:

```text
identity: independent=true
data_path: ...\tests\scratch_books.sqlite3
verification: phase=2, pending_after_settlement=50.00,
voucher_count=1, revision=24
```

The live check covered a phase-2 invoice, stable pending bill lookup,
revision-safe partial receipt allocation, pending balance reduction to
`50.00`, invoice-date ageing, and invalid-write immutability.

The original service was restored and verified at:

- application root: `C:\Users\Prime Steel\AppData\Local\Programs\IndependentBooks`
- data path: `C:\Users\Prime Steel\AppData\Local\IndependentBooks\data\books.sqlite3`
- export SHA-256 before/after: `4cac90bfe97681b659e5ad8d468d8348065d0a460dbdbdde51cbab8c6bdd79b3`

## Boundary

Phase 2 is verified for the approved bills/ageing workflow. The 1,000 nested
cascade catalog is a specification source; repeated catalog observations are
implemented through shared modal/keyboard mechanisms rather than duplicated as
1,000 independent flat forms. Warehouse/batch valuation and hierarchical
comparative reporting remain Phase 3 and Phase 4 work.
