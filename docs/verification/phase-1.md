# Phase 1 Verification

Date: 2026-10-11

## Automated checks

- `$env:PYTHONPATH='C:\Users\PRIMES~1\AppData\Local\Temp\omnirush\ib-browser-deps'; $env:NODE_OPTIONS=''; python -m pytest tests -q`
  - **20 passed**, no skipped tests.
- `node tests/test_voucher_logic.js`
  - **6 assertions passed**.
- `node tests/test_phase1_logic.js`
  - **10 assertions passed**.
- `python -m py_compile books.py app_server.py tests/live_phase_check.py`
  - **Passed**.
- `node --check workflows.js` and `node --check voucher_logic.js`
  - **Passed**.

## Live scratch-server gate

Command:

```powershell
python app_server.py --port 3543 --data tests/scratch_books.sqlite3
python tests/live_phase_check.py --port 3543 --phase 1
```

Observed scratch identity:

```json
{
  "application_root": "C:\\Users\\Prime Steel\\AppData\\Local\\Programs\\IndependentBooks",
  "data_path": "C:\\Users\\Prime Steel\\AppData\\Local\\Programs\\IndependentBooks\\tests\\scratch_books.sqlite3",
  "independent": true,
  "status": "online"
}
```

The live client created a unique phase-1 company, created masters, posted and
retrieved a balanced Journal voucher, checked its signed entries, then posted
an intentionally unbalanced voucher and confirmed that revision and voucher
count were unchanged.

## Restoration

After the gate, port 3543 was restored to:

- application root: `C:\Users\Prime Steel\AppData\Local\Programs\IndependentBooks`
- data path: `C:\Users\Prime Steel\AppData\Local\IndependentBooks\data\books.sqlite3`
- status: `online`
- original export SHA-256 before/after scratch gate:
  `4cac90bfe97681b659e5ad8d468d8348065d0a460dbdbdde51cbab8c6bdd79b3`

The scratch database remains isolated under `tests/` and was not used by the
installed company database.
