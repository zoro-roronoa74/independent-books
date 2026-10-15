# Tally Import, Voucher UX, Calendar, Printing, and Billing Design

**Date:** 2026-10-13  
**Status:** Approved design; implementation plan pending

## Goal

Make Independent Books able to import a complete Tally XML company bundle and provide a compact, configurable, and deterministic voucher workflow with calendar date selection and proper voucher/report printing.

## Current Context

The application already has verified accounting, bill allocation, inventory, GST, and financial-report workflows. The relevant current boundaries are:

- `interchange.py` handles version-1 JSON backups and one XML payload at a time.
- `app_server.py` exposes import preview/apply and the XML request boundary.
- `books.py` owns SQLite state, voucher validation, inventory replay, bill allocation, and financial calculations.
- `workflows.js` renders the voucher editor, date fields, import dialog, configuration dialog, and current `window.print()` action.
- `voucher_logic.js` contains client-side date, amount, and restricted calculator helpers.
- `fidelity.css` contains the application and current print styles.

The real database and native Tally data are not test fixtures. All implementation and verification must use isolated temporary SQLite databases or `tests/scratch_books.sqlite3`.

## Requirements

### Whole-company Tally import

1. Import one or more XML files as a single preview/apply operation.
2. Recognize Tally `ENVELOPE/IMPORTDATA/REQUESTDATA/TALLYMESSAGE` payloads.
3. Combine separate account-list and day-book files from the same company.
4. Import in dependency order: company metadata, groups, ledgers, units, stock groups/categories, godowns, stock items, voucher types, and vouchers.
5. Use Tally stable identifiers when present; otherwise use normalized names for matching.
6. Import must be atomic: any validation failure rolls back the entire bundle.
7. Return structured counts for companies, masters, vouchers, updates, warnings, skipped files, and contextual failures.
8. Prompt-only files containing no `TALLYMESSAGE` must be skipped with an explicit warning rather than treated as successful imports.
9. Preserve source XML and unrecognized fields through the existing source-import/metadata path.
10. Preserve imported bill allocation data and stable voucher identity even when the compact editor does not expose every source field.

### Calendar date selection

1. Clicking any date field opens a dependency-free calendar popup.
2. The picker supports month navigation and day selection.
3. Date fields continue to support typed Tally dates and `+`/`-` keyboard stepping.
4. Stored values remain compatible with existing `YYYYMMDD` and ISO conversion helpers.
5. Company financial-year, books-beginning, voucher, import, period, ageing, and working-date validation remains enforced.

### Compact voucher editor

1. Inventory voucher header order is party name followed by the sales or purchase ledger.
2. Inventory row order is exactly: item, quantity, alternate quantity, rate, amount.
3. Godown controls are absent from the normal voucher editor.
4. Reference-type controls are absent from the normal voucher editor and normal printout.
5. Bank-date controls are absent from the normal voucher editor and normal printout.
6. Existing source data is retained; hiding a field must not delete it.
7. Payment and receipt workflows retain the required bank/cash and party ledgers in a compact layout.
8. Bill allocation remains available through a separate explicit billing action when required by a bill-wise ledger.
9. The editor supports adding and removing item rows without imposing a fixed row count.

### Configurable billing calculation

1. Each company has billing profiles keyed by voucher base type.
2. The default inventory profile exposes item, quantity, alternate quantity, rate, and amount, with `qty * rate` as the formula.
3. Settings can rename/reorder visible columns, add numeric fields, choose a quantity basis, and define the amount formula.
4. Settings can be applied to each voucher row and users can add unlimited rows.
5. The formula language is restricted to numeric literals, named row fields, `+`, `-`, `*`, `/`, `%`, unary signs, and parentheses.
6. No JavaScript or Python `eval` is permitted.
7. The client may calculate previews, but the server recalculates with `Decimal` and is authoritative on save.
8. Invalid formulas, unknown fields, division by zero, non-finite results, and client/server mismatches are rejected with contextual errors.
9. Currency rounding occurs at the defined currency precision only.
10. Tally `ACTUALQTY` and `BILLEDQTY` map to main and alternate quantities while retaining original source data.

### Printing

1. Print uses a dedicated print model and renderer, not the application shell.
2. Voucher printing covers sales, purchase, credit/debit note, receipt, payment, contra, journal, and custom supported voucher types.
3. Report printing covers the currently visible report.
4. Voucher printouts include company header, party, voucher metadata, clean item or ledger rows, quantities, alternate quantities, rate, amount, totals, narration, and signature areas where applicable.
5. Ribbon, keyboard panel, dialogs, controls, reference-type UI, bank date, and godown columns are excluded.
6. Temporary print content is restored after printing.

## Design

### Import pipeline

The import API will accept the legacy single `xml` value and a new ordered `xmls` list. The parser will parse each document independently, classify prompt-only documents, collect `TALLYMESSAGE` nodes, derive the source company identity from `SVCURRENTCOMPANY` and `COMPANY/REMOTECMPNAME`, and merge all messages into one import plan.

The import plan will contain normalized records grouped by entity type. Stable identifiers will be stored in record metadata where available. The plan will validate all references before mutating the destination. Application to a candidate `Books` state will follow the dependency order above, then post vouchers only after all referenced masters exist. The existing candidate-copy/commit pattern will remain the transaction boundary.

The import result will be a JSON-safe report. A failed record will include file index/name when available, Tally entity type, source name or stable ID, and the validation message. No partial success will be committed.

### Billing rule kernel

Billing rules will be represented as company data, not hard-coded UI behavior. A profile will include visible field definitions, field kinds, labels, required/optional state, and a formula. The calculation kernel will tokenize and parse the restricted expression language into an AST, then evaluate it against validated decimal row values.

The Python implementation in the books layer is authoritative. The browser implementation will use the same grammar and fixture cases for preview parity. Voucher save will send raw row values and the profile identifier; the server will recompute each amount and reject a supplied amount that differs beyond the currency rounding policy.

Existing inventory posting and GST logic will consume the authoritative row amounts. The compact UI will not bypass current balance, inventory, bill allocation, or warning-token validation.

### Date picker

A small client-side date-picker module will manage popup state, month navigation, keyboard focus, and selection. It will bind by event delegation to `.tally-date` and voucher date fields so dynamically-rendered forms work without rebuilding every renderer. Selection writes the existing normalized value and dispatches the same input/change events used by typed entry.

### Voucher presentation

Voucher rendering will be split conceptually into:

1. A compact editor model that supplies header fields, configurable row fields, and hidden preservation data.
2. A posting collector that converts the editor model into the existing Tally-style voucher structure.
3. A print model that exposes only printable business fields.

The compact editor will omit godown, reference type, and bank date controls. When an existing voucher contains hidden fields, unchanged values remain in the cloned original structure. A changed row with unsupported multi-allocation data will fail safely with a contextual message rather than silently rewriting allocation history.

### Print renderer

The print renderer will build a temporary `.print-root` document from the current voucher draft or the current report DOM/model. It will use dedicated print CSS with stable table headers, currency alignment, page margins, and signature blocks. The renderer will not rely on the visual structure of the application shell. `afterprint` will remove temporary content and return focus to the previous control.

## Error handling

- Validate import structure and billing rules before expensive mutation.
- Use specific `ValueError` messages at the Python boundary, including entity and field context.
- Keep the candidate-state import transaction atomic.
- Never swallow parse, calculation, or print-model errors.
- Show user-facing errors through the existing error dialog/status path.
- Preserve raw source data when a field is intentionally hidden from the editor.

## Testing strategy

### Python tests

- Tally bundle classification and prompt-only skipping.
- Real local account-list/day-book fixture import into a temporary database.
- Master dependency ordering and company metadata extraction.
- Stable-ID and normalized-name matching.
- Atomic rollback after a late voucher failure.
- Formula parser/evaluator happy paths and invalid expressions.
- Decimal rounding, alternate quantity, division-by-zero, unknown-field, and mismatch rejection.
- Print model generation for accounting and inventory vouchers.

### JavaScript tests

- Calendar month navigation and selected-date normalization.
- Formula grammar parity fixtures.
- Compact row model and amount preview behavior.
- Print model excludes hidden fields and includes required columns.

### Browser tests

- Click-to-open calendar and date selection.
- Compact sales/purchase voucher field order and absence of godown/reference/bank-date controls.
- Configurable billing profile changes the visible row and server-saved amount.
- Dedicated print root contains voucher content rather than application chrome.
- Multi-file import preview and structured result display.

### Regression gates

Run the browser-enabled full pytest suite, JavaScript rule tests, syntax checks, the isolated live phase check, and the catalog validator. Do not use the real database or native Tally files for these tests.

## Assumptions

1. “No reference type” removes reference-type controls from normal voucher editing and printing; bill allocation data remains stored and can be managed through a separate billing action.
2. “No bank date” removes bank-date controls from normal editing and printing; imported `BANKDATE` remains preserved for round-trip fidelity.
3. “Add rows” means unlimited item rows plus configurable numeric fields and formulas per voucher base type.
4. Native `.1800`/`.TSF` decoding remains out of scope; supported migration input is Tally XML.

## Non-goals

- Rewriting the existing SQLite persistence layer.
- Launching or automating native TallyPrime.
- Claiming parity for every Tally statutory, payroll, payroll-tax, or proprietary feature.
- Arbitrary executable formulas or user-provided code.
- Importing directly into the active real company database during development.
