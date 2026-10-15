# Contextual Voucher Side Panel and Tally-Style Entry Design

**Date:** 2026-10-14  
**Status:** Design approved conversationally; written-spec review pending

## Goal

Replace modal voucher master lookup and inline `+ Ledger` controls with an automatic Tally-style contextual side panel that shows only valid choices for the active voucher field, supports cursor and mouse selection, provides contextual master creation, and saves with the same path when the user presses Enter on the final bottom ledger amount or Ctrl+A.

## Safety and evidence boundary

- Native TallyPrime executable, local Tally services, proprietary Tally data files, and ports `9000`/`9999` are not launched, accessed, or modified.
- Behavior is derived from the approved user interaction requirements, the existing Independent Books implementation, isolated browser tests, and supported Tally XML snapshots.
- Exact native visual parity can only be checked from user-provided screenshots or recordings; the implementation must not claim native runtime verification.

## Current context

- `workflows.js` currently renders voucher controls, injects `+ Ledger` buttons through `ledgerField()`/`ledgerSelect()`, and opens modal lookups through `chooseSelect()`.
- `#keys` is the existing right-side function-key panel.
- `state.data.ledgers` includes `parent`, `root_group`, and `group_type`; `group_records` is available to resolve nested groups.
- `state.data.stock_items`, `stock_groups`, and `stock_categories` are available for item lookup.
- `openInlineMaster()` preserves a voucher draft and returns to the originating field after master creation.
- Current payment filtering separates cash/bank names from party names but still renders a modal lookup.
- Existing posting, inventory, GST, bill allocation, billing-rule, and save logic must remain authoritative and unchanged except for lookup/navigation integration.

## Requirements

### Side panel

1. Voucher master selection must use a visible contextual side panel instead of the normal modal overlay.
2. The panel appears automatically whenever a voucher selection field receives focus.
3. The panel contains a search input, cursor-highlighted list, contextual Create button, and the existing function-key shortcuts below or beside it.
4. Mouse click selects a row.
5. Arrow Up/Down moves the cursor.
6. Enter selects the highlighted row and advances to the next voucher control.
7. Escape closes the active selection state without discarding the draft.
8. The panel changes context immediately when focus advances to another field.
9. A zero-result list shows an explicit empty state and retains the Create action when creation is valid.

### Inline creation removal

1. Remove all visible `+ Ledger` and `+` master buttons from voucher fields and rows.
2. Creation happens only through the contextual side-panel button.
3. The side-panel button label is context-specific: `Create Ledger`, `Create Sales Ledger`, `Create Purchase Ledger`, `Create Party Ledger`, `Create Expense Ledger`, `Create Income Ledger`, or `Create Item`.
4. Creation preserves the unfinished voucher, opens the existing master form, returns to the original field, refreshes the contextual list, and selects the newly created record.

### Context rules

#### Sales

- Party field: ledgers whose resolved effective system-group classification is `Sundry Debtors`.
- Sales ledger field: ledgers whose resolved effective system-group classification is `Sales Accounts`.
- Item field: stock items only, grouped by stock group/category where available.
- Additional ledger field: ledgers whose resolved root group is one of `Direct Expenses`, `Indirect Expenses`, `Direct Incomes`, or `Indirect Incomes`; exclude current party, main sales ledger, cash/bank ledgers, stock items, and automatic GST ledgers.

#### Purchase

- Party field: ledgers whose resolved effective system-group classification is `Sundry Creditors`.
- Purchase ledger field: ledgers whose resolved effective system-group classification is `Purchase Accounts`.
- Item field: stock items only.
- Additional ledger field: expense/income ledgers under the same four income/expense root groups, with the same exclusions.

#### Credit/debit notes

- Party and account contexts follow the corresponding debtor/creditor and sales/purchase effective system-group classifications.
- Item contexts remain stock-item-only.
- Additional rows use the expense/income context.

#### Payment and receipt

- Bank/cash field: only `Cash-in-Hand`, `Bank Accounts`, `Bank OCC A/c`, and `Bank OD A/c`.
- Party field: party ledgers under `Sundry Debtors` and `Sundry Creditors`, plus ledgers explicitly classified as bill-wise parties.
- No stock items appear in either payment/receipt selection list.

#### Contra and journal

- Ledger fields show accounting ledgers only.
- Stock items never appear in accounting-ledger selection.
- System-generated tax ledgers may be excluded from the normal list unless the voucher context explicitly requests tax selection.

#### Item fields

- Item fields show stock items only.
- The creation action is `Create Item`.
- Accounting ledgers never appear in item selection.

#### Bottom GST/additional ledger rows

- Manual adjustment rows use the expense/income list so users can select Delivery Charges, Freight, Discount, Rounding Off, and similar ledgers.
- Automatic CGST/SGST/IGST rows remain generated by the existing GST logic and are not duplicated in the manual side list.

### Cursor and Enter behavior

1. Opening a new voucher focuses its first logical selection field: party for sales/purchase, bank/cash for payment/receipt, and first ledger/item field for other voucher types.
2. The side panel follows that field.
3. Enter on a selected field chooses the highlighted panel row and advances.
4. Item rows retain sequential entry: item → quantity → alternate quantity when configured → rate → amount → next item row.
5. Bottom additional-ledger rows do not use Enter to silently create an unlimited row. An explicit Add Ledger Row control creates another row.
6. Enter on the amount of the final bottom additional-ledger row invokes the exact same immediate save function as Ctrl+A.
7. Ctrl+A continues to invoke that same save function.
8. Both paths use existing server validation, billing-rule calculation, inventory validation, GST calculation, bill allocation, revision checks, and warning-token checks.

### Filtering and ordering

- Filtering is computed by one shared `lookupContext(baseType, fieldName, rowContext)` function.
- Nested group membership is resolved through `group_records` and `parent` links, using each group's `system_group` classification where present. The resolver must not assume that `root_group` alone equals a Tally user-facing group name; for example, `Sundry Debtors` can be under the accounting root `Current Assets`.
- Lists are stable-sorted by display name, with the currently selected value first when editing an existing voucher.
- Search matches display name and relevant alias/group text.
- The panel must never mix ledgers and stock items in one context.

## Design

### UI structure

The existing right-side `#keys` area will become a voucher-aware panel. On voucher screens it will render:

1. Context title.
2. Search input.
3. Selectable rows with cursor highlight.
4. Contextual Create button.
5. Existing function-key buttons.

On reports, masters, company screens, and menus, it retains the current function-key behavior.

### State model

Add a transient lookup state to the existing client state:

```js
state.lookup = {
  field: 'party',
  kind: 'party',
  title: 'Customers',
  options: [],
  cursor: 0,
  query: '',
  create: {kind: 'ledger', parent: 'Sundry Debtors', label: 'Create Party Ledger'}
}
```

The state is UI-only and is not persisted into voucher data.

### Master creation lifecycle

The current `openInlineMaster()` behavior will be adapted to use the lookup context rather than a field-level plus button. The originating voucher frame retains the field name, row index, context kind, and return selection. After save, the side list is rebuilt from refreshed data and the new master is selected.

### Backend boundary

No new persistence schema is required for contextual lookup. Existing `data_view()` master/group data is sufficient. If a missing group classification is found during implementation, add a read-only derived helper rather than changing posting semantics.

## Error handling

- If the context cannot be resolved, show a clear `No contextual choices available` state and keep the raw control usable through typed entry where safe.
- If a user creates a master with an invalid parent or duplicate name, keep the voucher draft intact and show the existing error dialog.
- Never silently broaden a filtered list to all ledgers or all masters.
- Never remove or rewrite existing voucher fields merely because they are hidden from the side panel.

## Testing strategy

### JavaScript unit tests

- Context resolver returns the correct kind, root groups, exclusions, and Create label for each voucher/field combination.
- Nested group descendants are included.
- Cash/bank and party contexts are disjoint.
- Item and ledger contexts are disjoint.
- Stable sorting and cursor movement work with filtering.

### Browser tests

- No voucher contains visible `+ Ledger` buttons.
- Side panel appears automatically on voucher entry.
- Sales account panel excludes unrelated ledgers.
- Purchase account panel excludes unrelated ledgers.
- Item panel contains stock items only and shows `Create Item`.
- Payment/receipt bank panel contains cash/bank only.
- Payment/receipt party panel contains parties only.
- Bottom additional-ledger panel contains expense/income ledgers including delivery/freight.
- Enter changes panel context and selects the cursor row.
- Mouse selection works.
- Contextual creation returns to the original field.
- Enter on the final bottom ledger amount calls the same save result as Ctrl+A.

### Regression gates

- Existing browser voucher tests.
- Existing phase 1–4 tests.
- Full pytest suite with the isolated browser dependency path.
- JavaScript syntax and rule tests.
- Isolated live phase check using `tests/scratch_books.sqlite3`.
- Code review of the final diff and changed symbols.

## Non-goals

- Launching or reverse-engineering native TallyPrime.
- Changing accounting posting semantics.
- Replacing server-side validation with client-side filtering.
- Adding arbitrary voucher-specific ledger rules that are not supported by existing master metadata.
