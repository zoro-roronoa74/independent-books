# Independent Books Four-Phase Implementation Plan

> **For agentic workers:** Execute the linked plans sequentially with test-driven development and verification-before-completion. Native execution is proposed, pending plan review. The available harness has no `executing-plans` skill; use the explicit checklists here. No commits or agent delegation are authorized by this document.

**Goal:** Deliver the four workflow phases in the user's `/goal`, verifying each before the next.

**Architecture:** Extend the existing vanilla JS state machine and standard-library
Python engine. Introduce one canonical voucher draft and nested dialog stack,
then build bill and inventory allocation on those interfaces. Keep version-1
SQLite payloads and historical revisions backward compatible.

**Tech Stack:** Vanilla JavaScript, Python 3.9+, SQLite, Decimal; development-only pytest, Playwright/Edge and Node.

**Spec:** `../specs/2026-10-11-accounting-workflows.md`

## Global Constraints

- Runtime: no external libraries, frameworks, external servers or Tally process.
- Database: no destructive resets, table replacement or history deletion;
  additive, idempotent changes only, with old backups remaining readable.
- Tests first for frontend and backend; diagnose failures before edits.
- Preserve exact gates: `python -m pytest tests -q` and
  `python app_server.py --port 3543 --data tests/scratch_books.sqlite3`.
- No completion claim with failing/skipped feature tests or unqueried postings.
- No product edits before this plan has been reviewed; no phase starts before
  its own detailed plan exists and the previous phase's gate passes.

## Review Focus

1. Draft loss, mixed-mode duplicate postings and modal focus: Phase 1 P1.1/P1.2.
2. Zero-rated items and preview/saved tax disagreement: Phase 1 P1.1.
3. Altered or concurrently settled bills and missing dates: Phase 2 P2.1/P2.3.
4. Location isolation, compound dimensions and shortage recovery: Phase 3 P3.1-P3.3.
5. Parent-child double counts and period loss on drill-down: Phase 4 P4.1-P4.3.

## Baseline inspected on 2026-10-11

- Target installation has no local AGENTS.md and no implementation docs before
  these artifacts. Product files and existing user data were inspected read-only.
- `python -m pytest tests -q`: **7 passed** with the browser test dependency path
  enabled; `node tests/test_voucher_logic.js`: **6 assertions passed**.
- `verify_catalog.py discrepancies_catalog.json --final --markdown
  tally_vs_independent_books_1000_details.md`: **PASS, 1,200 entries**.
- Catalog IDs do not always describe the requested features; the spec records
  mismatches. Structural validation is not evidence of complete native parity.
- Working app identity: `http://127.0.0.1:3543`, application root is this install,
  data path `C:\Users\Prime Steel\AppData\Local\IndependentBooks\data\books.sqlite3`.
  `tests/scratch_books.sqlite3` does not yet exist.
- Existing `save(page)` browser helper expects a confirmation dialog. Phase 1
  must deliberately update that expectation for the requested immediate Ctrl+A.
- Browser tests currently use importorskip; the release gate must load Playwright
  and run them, never accept the two-test/one-skipped fallback as 100% verification.

## Execution order and plan artifacts

| Phase | Detailed plan | Status |
|---|---|---|
| 1 | [Keyboard and voucher mechanics](2026-10-11-phase-1-voucher-mechanics.md) | Verified |
| 2 | [Bills and ageing](2026-10-11-phase-2-bills-ageing.md) | Verified |
| 3 | [Inventory and valuation](2026-10-11-phase-3-inventory.md) | Isolated verified; live baseline open |
| 4 | [Reports and drill-down](2026-10-11-phase-4-reporting.md) | Isolated verified; live baseline open |

## Shared test and live-server gate (created in P1.1)

Create `tests/conftest.py` to own `books_db` (temporary SQLite), `app` (temporary
server plus Edge page) and cleanup via try/finally. Browser errors are failures.
Create `tests/test_client_rules.py` to run Node tests with `subprocess.run`, capture
full output, and assert return code zero. No product-side test-only methods.

Create `tests/live_phase_check.py` with these exact interfaces:

- `require_scratch_identity(base_url: str, expected_path: Path) -> dict`: GET
  `/api/status`; compare independent marker, application root and resolved data
  path. Any mismatch aborts before any POST.
- `seed_test_company(base_url: str, phase: int) -> str`: unique UUID-suffixed
  company, test ledgers/items through API; never restore/delete any database.
- `verify_phase(base_url: str, phase: int) -> dict`: create a balanced voucher,
  GET it by ID, assert signed entries and phase-specific quantities/allocations/
  reports. Also POST one invalid voucher and assert no change in revision/count.
- CLI: `python tests/live_phase_check.py --port 3543 --phase N`.

Before replacing the port-3543 listener, capture its `/api/status` and export
digest, identify its owning process and shutdown only that known instance.
Wait for the port and storage lock to close; keep the existing browser draft
open. Start the user's exact command below, poll identity instead of sleeping
for a guessed duration. After tests, shut down only this scratch process and
restart the saved original server path/data; assert original data export digest.
Never run `Launch.ps1` while the scratch instance occupies its normal port.

```powershell
# Environment needed for the existing development-only browser installation:
$env:PYTHONPATH='C:\Users\PRIMES~1\AppData\Local\Temp\omnirush\ib-browser-deps'
$env:NODE_OPTIONS=''
python -m pytest tests -q
# Run in a managed process; retain PID for orderly shutdown/finally cleanup:
python app_server.py --port 3543 --data tests/scratch_books.sqlite3
# From another shell in this installation:
python tests/live_phase_check.py --port 3543 --phase 1
```

Run the same two user-specified commands for every phase, incrementing only the
phase argument to the assertion client. Record counts, skipped count, API
assertions and restoration identity in `docs/verification/phase-N.md` only
after those commands actually run. Syntax checks supplement these gates.

## Planning review checklist

- [x] All requested feature descriptions have a task in a linked plan.
- [x] Functions, event-handler priority, payload additions and old-data behavior specified.
- [x] Review-focus conditions assigned to tests with hand-calculated outcomes.
- [x] Live test data isolation accounts for the occupied port 3543.
- [x] User review of proposed behavior/schema contracts and execution method.
- [x] Phase 1 complete and verified.
- [x] Phase 2 complete and verified.
- [ ] Phase 3 complete and verified (live-data baseline follow-up open).
- [ ] Phase 4 complete and verified (live-data baseline follow-up open).
