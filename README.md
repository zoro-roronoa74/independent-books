# Independent Books — TallyPrime reference interface build

Double-click **Launch.vbs** to open the application. Keep this folder together. A Python runtime is included; TallyPrime and a separate Python installation are not needed. Edge or Chrome opens it in an application window. The server listens only on `127.0.0.1`; the launcher starts at port 3543 and uses an available port through 3553 for another extracted copy.

This is a working independent implementation, **not a completed, zero-difference copy of TallyPrime**. The supplied screenshots and recording informed the screen families, terminology, layout and colours. Browser controls, several layouts, and advanced Tally features still differ. No paid-service connection or Tally license is supplied or simulated.

## Start with your company

A newly extracted package starts with an empty database; the portable ZIP contains no company database. Existing local books are preserved when opening this folder again. Choose **Create Company** and enter its financial period and details, then create the required masters. There are no preset parties, transactions, amounts, GST rates, addresses, business names or company currency. Standard accounting groups, voucher classifications and primary inventory categories are structural definitions.

Your books are saved in `data/books.sqlite3` using SQLite transactions. **Data → Backup** exports all companies to a validated portable JSON backup. **Data → Restore** previews and restores that backup. SQLite history retains committed snapshots, including changes before voucher deletion, but a history recovery screen has not been implemented.

## Implemented workflows

- Company creation/alteration and explicit company selection.
- Creation/alteration of ledgers, groups, stock items, units, godowns, voucher types, stock groups/categories, cost categories/centres and currencies.
- Accounting vouchers, invoice entry, inventory vouchers, stable voucher alteration, cancellation and deletion; optional vouchers remain outside balances.
- Day Book, Trial Balance, ledger/group drill-downs, monthly registers, Stock Summary/item vouchers, bill references/outstandings, basic bank/cheque details, statistics and a dashboard.
- Derived Balance Sheet and Profit & Loss views, with actual differences displayed instead of invented balancing amounts. Inventory valuation uses moving weighted average; returns use the prevailing cost. Negative stock is rejected.
- Report-period filtering; exact decimal amounts in storage and integer-based monetary sums in the interface.
- XML master/voucher import with a preview and an atomic commit. Unknown fields and source XML are retained. Partial master alteration retains omitted values.
- Multi-file Tally XML bundle import combines account-list and day-book exports, skips prompt-only files with a warning, imports dependencies before vouchers, and reports contextual failures without partial saves.
- XML export, real report CSV/HTML export, dedicated voucher/report printing, and full JSON backup.
- Clickable calendar date selection with typed Tally dates and keyboard stepping.
- Compact inventory voucher rows (`Item`, `Quantity`, `Alt Quantity`, `Rate`, `Amount`) with hidden-field preservation and company-configurable billing profiles. Formula previews use a restricted grammar; saved amounts are recalculated and validated by the server with `Decimal`.
- Shared navigation with Enter/arrows/Esc, F2/F3/F4–F10, Alt+G and Ctrl+A. Creating a master retains the unfinished parent form.

## Data migration and current limits

The application **does not read Tally's proprietary company data files directly**. For migration, export the company’s masters and vouchers from Tally as XML, select the destination company, choose all related XML files in **Import → Preview**, and review the counts/warnings before committing. Account-list and day-book files can be imported together. Prompt-only XML files are reported and skipped. Import/export compatibility with every native Tally schema and company configuration has not been verified against a live Tally installation.

The exported company XML combines masters and vouchers for this application's portable interchange. It is not a certified native Tally import envelope. Renamed system-group classification uses a `BOOKSCLASSIFICATION` attribute so this application can retain the original meaning.

GST return computation/filing, e-invoices/e-way bills, payroll, TDS/TCS, multi-currency conversion, connected banking, invoice tracking reconciliation, FIFO/batch valuation, price levels, manufacturing/BOM and every F11/F12 option are not implemented. Native `.1800`/`.TSF` decoding is not implemented; supported migration input is Tally XML. Existing complex bill/batch fields are retained; edits requiring unsupported allocation detail are rejected instead of silently rewriting them. These limits mean this build is not yet a complete replacement for every Tally company.

The inventory and financial report calculations need further side-by-side comparison for integrated accounts/inventory configurations. Tally itself exposes integration settings and stock valuation options: see its [Balance Sheet documentation](https://help.tallysolutions.com/balance-sheet-tally/) and [Trial Balance documentation](https://help.tallysolutions.com/tally-prime/accounting-financial-reports/trial-balance-tally/).

No AI model, automation provider, telemetry, account sign-in or remote database is connected.

## Development and verification

Run `runtime\python.exe -E -s app_server.py --port 3543` for diagnostic output. A different database can be supplied with `--data PATH`; keep test data outside `data/`. Default launching scans ports 3543–3553 and reuses only the running copy from this folder. Use `Launch.ps1 -Port 3545` to request a specific port. A database ownership lock prevents a second server from independently writing the same books file. `-NoBrowser` starts only the local server for diagnostic checks.

The Python suite uses pytest as a development dependency; the application itself uses only the included standard library. Run `python -m pytest tests -q` with pytest installed, and `node tests/test_workflows.cjs` for the interface calculation/preservation regressions. See [VERIFICATION.md](VERIFICATION.md) for the checks performed and their limits.

Original handoff files were inspected but the old seeded simulator is not part of the running application. The independent engine and shared controller replace its hardcoded amounts and unsafe mutation paths.
