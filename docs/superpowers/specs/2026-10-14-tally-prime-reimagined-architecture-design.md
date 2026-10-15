# Independent Books - Tally Prime Reimagined: Modern Architecture & Feature Parity Design

**Date:** 2026-10-14  
**Status:** Approved by Human Partner  
**Scope:** Architectural Overhaul & System-Wide Enhancement  

---

## 1. Executive Summary & Vision

Independent Books is an open-source, air-gapped, zero-dependency accounting application designed as a 1:1 functional counterpart to Tally Prime. This specification establishes the architecture for transforming Independent Books into a modern, glassmorphic desktop application while maintaining strict keyboard ergonomics, accounting invariants (double-entry debit/credit equality, balance sheet reconciliation, GST fidelity), and ultra-lightweight performance on low-spec hardware (< 50 MB RAM).

---

## 2. Visual Architecture & Design System

### 2.1 Glassmorphic Aesthetics (`fidelity.css`)
* **Palette**: Dark emerald glass backdrop (`rgba(15, 40, 30, 0.85)`), translucent surface panels (`rgba(27, 67, 50, 0.65)` with `backdrop-filter: blur(14px)`), and crisp mint highlights (`#74C69D`).
* **Geometry**: Rounded corners (`border-radius: 12px` for major cards and dashboard widgets; `6px` for table cells, badges, and controls).
* **Typography**: Monospaced tabular numerals for all financial amounts; high-contrast geometric sans-serif for UI labels and titles. Zero text clipping or awkward wrapping.
* **Iconography**: Clean, minimalist vector SVGs (Settings gear icon for `F12`, Calendar icon for `F2: Date`, Printer icon for `Ctrl+P`, Search lens icon in dropdowns). Strictly zero emojis.
* **Micro-Interactions**: Hardware-accelerated CSS `transform` and `opacity` transitions (180ms ease-out) for smooth, non-blocking page transitions, dropdown reveals, and modal popups.

### 2.2 Redesigned Gateway Screen (Live KPI Dashboard)
Replaces the static left side of the Gateway with an interactive operational dashboard:
1. **Today's Sales Widget**: Displays total billed amount (₹) and invoice count for today. Clicking opens the Day Book pre-filtered to Today's Sales.
2. **Today's Collections Widget**: Displays total Cash + Bank receipts collected today. Clicking opens the Day Book pre-filtered to Today's Receipts.
3. **Receivables & Payables Summary**:
   * *Due from Customers*: Total outstanding across all `Sundry Debtors`.
   * *Due to Suppliers*: Total outstanding across all `Sundry Creditors`.
4. **This Month's Profit Widget**: Real-time margin calculation for the active month (Sales − Cost of Goods Sold − Operating Expenses).
5. **Interactive Performance Trend Chart**: Clean vector trend line toggleable between **Week**, **Month**, and **Year**.
6. **Keyboard Access**: Preserves all standard Gateway keyboard hotkeys (`V` for Vouchers, `K` for Day Book, `B` for Balance Sheet, `P` for P&L, `S` for Stock Summary, `A` for Alter, `C` for Create).

---

## 3. Voucher Entry & In-Place Search Experience

### 3.1 In-Place Substring Search on Every Field
* **Direct In-Input Typing**: The user types directly into the active field (Party, Sales Ledger, Stock Item, Expense, Bank/Cash). The separate search input is eliminated.
* **Substring / Middle-Word Matching**: Text typed matches anywhere within the name or alias (e.g., typing `"12"` or `"bar"` matches `"Jindal TMT Bar 12MM"`).
* **Floating Dropdown**: A sleek glassmorphic dropdown anchors directly beneath the active input.
* **Navigation & Selection**:
  * `Arrow Up` / `Arrow Down`: Moves active cursor in the floating list.
  * `Enter`: Selects the highlighted choice and smoothly advances focus to the next logical control in the invoice sequence.
  * `Escape`: Dismisses the dropdown without discarding draft input.
* **Right Panel Master Information**: The right-side `#keys` panel synchronizes in real time to display context-specific master metadata (Party closing balance, Stock Item closing quantity, Godown distribution, and last sale rate).

### 3.2 Overwrite-on-Type & Backspace Navigation
* **Auto-Select on Focus**: Whenever focus enters an input (via `Tab`, `Enter`, or navigating backwards via `Backspace`), the existing text is fully highlighted (`input.select()`).
* **Instant Overwrite**: Typing any character immediately replaces the previous value without requiring manual deletion.
* **Enter to Retain**: Pressing `Enter` without typing retains the existing or auto-filled value and advances to the next box.

### 3.3 Unified Voucher Grid & UI Cleanup
* **Zero Clutter Text**: The `"Additional ledgers"` header text and `"GST rows appear automatically when GST is enabled"` banner are completely removed.
* **Continuous Table Layout**: Line items for stock items flow directly into expense and charge rows (Carriage Inward, Loading Charges, Freight, Delivery, Cash Discount).
* **Current Date Defaulting**: The date picker and date fields initialize to the real-world system date (today in 2026), eliminating legacy year-2000 fallbacks. `+` and `-` keys step calendar dates by day.

---

## 4. Calculation Engine, Item-Level GST & Standard Rates

### 4.1 Stock Item Standard Purchase & Selling Rates
* Stock Items store optional `standard_purchase_rate` and `standard_selling_rate`.
* In **Sales Vouchers**: Selecting an item auto-populates the Rate field with the item's standard selling rate.
* In **Purchase Vouchers**: Auto-populates with the standard purchase rate.
* The rate field is automatically highlighted for instant overwrite if a different negotiated rate applies.
* **In-App Item Rates Manager**: Gateway provides a dedicated spreadsheet-style table view where all item names, purchase rates, and selling rates can be inspected and updated in bulk.

### 4.2 Automated State-Aware & Item-Registered GST Engine
* **Item-Level Tax Configurations**: Each stock item registers its tax percentage (e.g. 18%, 12%, 5%, 0% / Exempt).
* **State-Aware Tax Derivation**:
  * **Intra-State (Company State == Party State)**: Generates matching `Central GST (CGST)` and `State GST (SGST)` lines (e.g. 9% + 9% for an 18% item).
  * **Inter-State (Company State != Party State)**: Generates a single `Integrated GST (IGST)` line (18%).
  * **Exempt / Nil-Rated**: Excluded from tax calculation; no redundant zero-value tax rows are created.
* **Decimal Precision**: All arithmetic is executed using Python's `Decimal` module and strict half-up rounding to guarantee exact accounting reconciliation down to the paise.

### 4.3 F12 Dynamic Formula Manager (Multi-Formula Evaluation)
* An unopinionated, flexible formula engine accessible via `F12: Configuration`.
* Supports defining multiple live-calculated columns (e.g., `weight_per_pc = alt_qty / qty`, `rate_per_kg = amount / alt_qty`, or custom volumetric conversions).
* Evaluates instantaneously in real-time as users enter numbers into quantity or alternate quantity boxes.

### 4.4 Contextual F12 Configurations
* F12 is strictly contextual to the active view:
  * On Vouchers: Displays Voucher Entry & Billing Configuration (Formula Manager, Item Details, References).
  * On Reports: Displays Report Presentation Configuration (Show Narration, Condensed vs Detailed, Sorting).
  * On Masters: Displays Master Schema Configuration.
* The billing configuration is never inappropriately rendered on non-voucher screens.

---

## 5. Tally XML Data Import & Bulk Master Operations

### 5.1 Full TallyPrime XML Ingestion
* Ingests both **All Masters** (Groups, Ledgers, Units, Stock Groups, Stock Items, Godowns) and **Day Book** (Sales, Purchases, Receipts, Payments, Journals, Contras).
* Dependency-ordered staging: resolves parent groups and units before creating ledgers/items; resolves masters before posting transactions.
* Clear diagnostic reporting on split or partial files with automatic atomic rollback to protect database integrity.

### 5.2 Downloadable Sample Templates (Excel `.xlsx` and `.csv`)
* Users can download pre-formatted sample files directly from the application:
  1. `sample_bulk_ledgers.xlsx` & `.csv`: Contains headers for `Ledger Name`, `Parent Group`, `Opening Balance`, `Dr/Cr`, `GSTIN`, `State`, `Address`, `Pincode`, and `Credit Days`.
  2. `sample_bulk_items.xlsx` & `.csv`: Contains headers for `Item Name`, `Stock Group`, `Base Unit`, `Alt Unit`, `Conversion Rate`, `HSN Code`, `GST Rate %`, `Standard Purchase Rate`, `Standard Selling Rate`, `Opening Qty`, and `Opening Rate`.
* **Bulk Import Engine**: Uploading a completed `.xlsx` or `.csv` validates all rows in a single batch, updating existing records or creating new ones with duplicate protection.

---

## 6. Modular `Ctrl+P` Print Overlay & Invoice Customizer

### 6.1 Tally-Style 3-Action Print Dialog
Pressing `Ctrl+P` on any voucher opens a clean modal with three primary actions:
* **Print (`P` / `Enter`)**: Immediately initiates the print dialog or sends to default printer.
* **Preview (`I`)**: Renders an exact full-page invoice preview document.
* **Configure (`C`)**: Opens the modular print configuration panel.

### 6.2 Modular Invoice Layout Configuration
* **Border Mode**: Toggle between full boxed border grid vs modern borderless invoice styling.
* **Header Customization**: Resizable upper section; toggle company legal name vs trade alias, full address, GSTIN, document title (*Tax Invoice*, *Bill of Supply*), and buyer/consignee address blocks.
* **Protected Middle Section**: Standardized, tamper-proof line item table (Item name, HSN, Quantity, Alt Quantity, Rate, Amount, and GST tax breakup).
* **Footer Customization**: Resizable bottom section; toggle Bank Details (Bank Name, Account Number, IFSC, Branch), Amount in Words, Terms & Conditions, and Authorized Signatory box.

---

## 7. Packaging (.exe Installer), Air-Gapped Security & Auto-Update

### 7.1 Standalone Windows Installer (`.exe`)
* Packaged via Inno Setup / standalone bundler into `IndependentBooksSetup.exe`.
* Bundles the compact Python runtime (`runtime/`) so the app installs and runs on any Windows 10/11 system without requiring Python or administrative privileges.
* Creates Desktop (`Independent Books.lnk`), Start Menu shortcuts, and a standard Windows Uninstaller.

### 7.2 Air-Gapped Local Privacy
* Strictly offline: all company databases reside locally in `%LOCALAPPDATA%\IndependentBooks\data\books.sqlite3`.
* Zero outbound analytics, tracking, or network telemetry. No financial information ever leaves the user's computer.

### 7.3 In-App Update Checker
* Accessible via **Gateway > Help / About > Check for Updates**.
* Performs an on-demand check against a configured release manifest when explicitly triggered by the user.
* Displays a non-intrusive glass alert banner when an update is available, showing changelog notes and an update link.

---

## 8. Verification & Quality Gates

1. **Unit & Logic Tests**: Node.js tests for `lookup_context.js`, `workflows.js`, `date_picker.js`, `print_view.js`, and `billing_rules.py`.
2. **Double-Entry & Math Invariants**: Pytest suite verifying `Decimal` arithmetic, state-aware GST breakdowns, formula computations, and debit/credit equality.
3. **Browser Automation**: Playwright tests verifying in-place typing, dropdown navigation, backspace overwrite, `Ctrl+P` printing, and Gateway dashboard widgets.
4. **Hardware Performance**: Verify memory consumption stays under 50 MB RAM and UI frame rates maintain 60 fps during screen transitions.
