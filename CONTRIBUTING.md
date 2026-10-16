# Contributing to Independent Books 🚀

First off, thank you for considering contributing to **Independent Books**! Open-source financial tools need careful engineering, transparent accounting, and community scrutiny to build something truly reliable.

Whether you are fixing a typo, adding tests for complex GST calculations, refining keyboard ergonomics, or submitting an entirely new report, we welcome your contributions!

---

## 🧭 Principles & Architecture

Before submitting code, please keep our core tenets in mind:

1. **100% Offline & Air-Gapped**: The application runs on `127.0.0.1` and never phones home. No remote telemetry, no third-party tracking scripts, no mandatory cloud logins.
2. **Exact Decimal Accounting**: Financial amounts are stored with exact `Decimal` precision. Floating-point arithmetic (`0.1 + 0.2 = 0.30000000000000004`) is strictly forbidden for currency calculations.
3. **Keyboard-First Ergonomics**: Every action must be accessible via keyboard shortcuts (<kbd>Enter</kbd>, <kbd>Esc</kbd>, <kbd>F2</kbd>–<kbd>F10</kbd>, <kbd>Alt</kbd>+<kbd>G</kbd>, <kbd>Ctrl</kbd>+<kbd>A</kbd>).
4. **Zero-Bloat Runtime**: The backend is lightweight Python with standard library dependencies wherever possible, compiled into native binaries for production.

---

## 🛠️ Setting Up Your Local Development Environment

### Prerequisites
- **Python**: 3.9 or higher (standard CPython)
- **Node.js**: v18+ (for frontend workflow test suites)
- **Git**

### Steps

1. **Fork and Clone**:
   ```bash
   git clone https://github.com/<your-username>/independent-books.git
   cd independent-books
   ```

2. **Create a Virtual Environment**:
   ```bash
   python -m venv venv
   # On Windows:
   .\venv\Scripts\activate
   # On macOS/Linux:
   source venv/bin/activate
   ```

3. **Install Development Dependencies**:
   ```bash
   pip install pytest pytest-cov
   ```

4. **Launch the Development Server**:
   ```bash
   python app_server.py --port 3543
   ```
   Open your browser at `http://127.0.0.1:3543`.

---

## 🧪 Running Verification Tests

We maintain strict test-driven development to ensure no regressions in financial reporting:

```bash
# Run all Python backend and accounting integrity tests
pytest tests -q

# Run frontend calculation and workflow tests
node tests/test_contextual_lookup.js
node tests/test_date_picker.js
node tests/test_phase1_logic.js
node tests/test_print_view.js
node tests/test_voucher_logic.js
```

**All tests must pass** before opening a pull request.

---

## 💡 How Can I Contribute?

### 1. Financial & Accounting Test Cases
Edge cases in inventory valuation (Weighted Average Cost), credit note tax balancing, inter-state IGST splits, or round-off differences make incredible test contributions. Add test cases in `tests/`.

### 2. UI/UX & Keyboard Shortcuts
Polishing dialog focus loops, dropdown search speed, and accessible color contrast.

### 3. Documentation & Guides
Improving user guides, XML import/export specifications, or sample accounting workflows.

---

## 📝 Submitting a Pull Request (PR)

1. Create a feature branch from `master`:
   ```bash
   git checkout -b feature/my-cool-feature
   ```
2. Commit your changes with descriptive messages:
   ```bash
   git commit -m "Add: support for multi-rate GST voucher splits"
   ```
3. Run the test suite:
   ```bash
   pytest tests -q
   ```
4. Push to your fork:
   ```bash
   git push origin feature/my-cool-feature
   ```
5. Open a Pull Request against `master`. Our GitHub Actions CI will automatically test your changes!

---

## ⭐ Star the Project
If you use or support Independent Books, please consider starring the repository — it helps more independent businesses and developers discover truly open-source accounting tools!
