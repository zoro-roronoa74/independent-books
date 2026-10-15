# Phase 3 verification: inventory, units, FIFO, and shortage handling

Date: 2026-10-12

## Implemented and tested

- Compound unit parsing and dimension/cycle-safe conversion (`Box` to `Nos`).
- Godown, batch, expiry, and stable line allocation metadata.
- Nested tracked-item allocation modal with multiple allocation rows,
  `Ctrl+A` child acceptance, and Esc cancellation.
- FIFO layer replay and moving-average/FIFO issue valuation with provisional
  shortage values.
- Company `warn`/`block` negative-stock policy, read-only inventory preview,
  warning tokens, revision-checked warning acknowledgement, and structured
  preview API responses.
- Version-1 backup/XML preservation of unit conversion and batch allocation
  metadata.

## Automated checks

With browser dependencies enabled:

```powershell
$env:PYTHONPATH='C:\Users\Prime Steel\AppData\Local\Temp\omnirush\ib-browser-deps'
$env:NODE_OPTIONS=''
python -m pytest tests -q
```

Result: **43 passed**, 0 failed, 0 skipped.

The focused Phase 3 suites passed:

- `python -m pytest tests/test_phase3_inventory.py -q`: **5 passed**.
- `python -m pytest tests/test_phase3_browser.py -q`: **1 passed**.
- Python compilation and JavaScript syntax checks passed.
- Node suites passed with **6** existing assertions and **23** Phase 1
  assertions.

## Isolated live-server gate

The scratch server identity was verified against:

`C:\Users\Prime Steel\AppData\Local\Programs\IndependentBooks\tests\scratch_books.sqlite3`

Executed:

```powershell
python tests/live_phase_check.py --port 3543 --phase 3
```

Result: `independent=true`, `revision=38`, `voucher_count=1`, and
`inventory_warning_commit=true`. The gate covered a receipt, an over-issue
preview, a warning token, and an acknowledged warning commit.

## Data-integrity follow-up

The original service was restored with the correct application root and real
data path. The known baseline export SHA-256 before the scratch run was:

`4cac90bfe97681b659e5ad8d468d8348065d0a460dbdbdde51cbab8c6bdd79b3`

After restoration, the service reported the correct real path, but the export
was `171821` bytes with SHA-256
`ed7593c59295a49ad50563d5d88dda000a36b1ec63ee7f26f0c0d753868459a4`.
At the final read-only check, after two further live postings, it was `177761`
bytes with SHA-256
`0f6eabd421eb2d4666a1a6790a9d9160e75c3e4c48c84c642b0cbeedd8f0d93c`.
Read-only SQLite inspection showed revisions 16–83 dated
`2026-10-12T06:40:08` through `06:46:31`, while revision 15 is the known
10,024-byte baseline matching the earlier digest. After the gate, additional
revisions 84 and 85 were created at `07:37:57` and `07:39:00`, adding a
Purchase and a Payment voucher. The active process list shows the restored
Independent Books server running from the embedded runtime against the real
database, confirming that live application activity is continuing outside the
isolated scratch gate. The current database was not reverted, because
reverting would discard data that is now present and the approved constraints
prohibit destructive restoration without authority.

Therefore Phase 3 behavior is test- and scratch-gate verified. Phase 4 was
subsequently implemented and independently scratch-gate verified. The
real-data digest cannot be used as a static before/after gate while the real
application continues to receive user postings; final release verification
remains open until the database is quiescent or a new baseline is explicitly
accepted.
