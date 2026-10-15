# Tally Import, Voucher, Billing, Calendar, and Printing Verification

## Scope

This record covers the supported XML migration and voucher presentation changes:

- Multiple Tally XML files can be previewed/imported as one atomic bundle.
- Account-list and day-book `TALLYMESSAGE` records are normalized before dependency-ordered application.
- Prompt-only XML files are skipped and reported.
- A late validation failure leaves the destination unchanged.
- Billing profiles use a restricted, non-executable formula grammar. Python `Decimal` calculation is authoritative on save.
- Date fields open a dependency-free calendar popup while retaining typed Tally dates and keyboard stepping.
- Inventory vouchers use the compact item/quantity/alternate-quantity/rate/amount layout.
- Reference type, bank date, and godown controls are absent from the normal compact voucher UI and print view while stored source fields remain preserved.
- Voucher and report printing uses a dedicated print document.
- Voucher ledger/item selection uses an automatic contextual side panel rather than visible inline `+ Ledger` controls.
- Sales, Purchase, Payment, Receipt, Journal, inventory, and additional-ledger contexts are filtered by effective Tally group classification and stock-item kind.
- Contextual master creation preserves the unfinished voucher and returns to the originating field/row.
- Final additional-ledger Enter and Ctrl+A use the same immediate save path.

## Fixtures and safety boundary

- Isolated tests use pytest temporary databases and browser fixtures.
- Tally snapshot diagnostics are read from `C:\Users\Prime Steel\AppData\Local\Temp\omnirush\tally-snapshot` only.
- The active database under `C:\Users\Prime Steel\AppData\Local\IndependentBooks\data` is not used by the tests.
- Native Tally data under `C:\Users\Public\TallyPrime\data\100000` is not read or modified.

## Focused checks

Run with the browser dependency path when browser coverage is available:

```powershell
$env:PYTHONPATH='C:\Users\PRIMES~1\AppData\Local\Temp\omnirush\ib-browser-deps'
$env:NODE_OPTIONS=''
python -m pytest tests/test_tally_bundle_import.py tests/test_billing_rules.py tests/test_billing_settings_browser.py tests/test_browser_vouchers.py tests/test_print_browser.py -q
```

Additional pure JavaScript checks:

```powershell
node tests/test_voucher_logic.js
node tests/test_date_picker.js
node tests/test_print_view.js
node tests/test_contextual_lookup.js
```

## Contextual voucher verification

The current isolated verification was run with the local browser dependency installed in the test Python environment:

```powershell
$env:PYTHONPATH='.'
$env:NODE_OPTIONS=''
pytest -q
```

Result: `82 passed`.

The focused contextual checks are:

```powershell
$env:PYTHONPATH='.'
$env:NODE_OPTIONS=''
pytest -q tests/test_contextual_lookup_browser.py tests/test_browser_vouchers.py
```

The browser harness uses Microsoft Edge through Playwright and temporary SQLite databases. It does not launch native TallyPrime or access native Tally services/data.

## Known migration boundary

The local `100003` diagnostic account-list and day-book files demonstrate Tally’s split XML shape. The day book references stock items that are not present in the account-list file; the importer reports that missing dependency and rolls the bundle back rather than inventing a stock master. A complete migration bundle must include the relevant stock masters.

Native `.1800` and `.TSF` company files remain outside the supported input boundary.
