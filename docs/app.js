/* ==========================================================================
   Independent Books — Creative Interactive Script
   Includes:
   1. Live Tab Switcher with Keyboard Hotkeys (G, F8, B, P)
   2. Interactive State-Aware GST Invoice Calculator + Balanced Seal Stamp
   3. The "Tally Tax" Rent Extractor / Cost Savings Interactive Slider
   4. Tactile 3D Keycap Press Feedback on Physical Typing
   5. 1-Click Verified SHA-256 Checksum Copier
   ========================================================================== */

document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  // -------------------------------------------------------------------------
  // 1. Live Interactive Simulator Tab Switching
  // -------------------------------------------------------------------------
  const tabBtns = document.querySelectorAll('.sim-tab-btn');
  const simViews = document.querySelectorAll('.sim-view');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', function () {
      const targetView = this.dataset.tab;
      
      tabBtns.forEach(b => b.classList.remove('active'));
      simViews.forEach(v => v.classList.remove('active'));

      this.classList.add('active');
      const activeEl = document.getElementById('view-' + targetView);
      if (activeEl) {
        activeEl.classList.add('active');
      }
    });
  });

  function switchTab(name) {
    const btn = document.querySelector(`.sim-tab-btn[data-tab="${name}"]`);
    if (btn) btn.click();
  }

  // -------------------------------------------------------------------------
  // 2. Keyboard Hotkey Listeners & Tactile 3D Keycap Press Feedback
  // -------------------------------------------------------------------------
  document.addEventListener('keydown', function (e) {
    // Flash corresponding keycap on screen if present
    const keyText = e.key.toUpperCase();
    const matchingKbds = document.querySelectorAll('kbd');
    matchingKbds.forEach(kbd => {
      if (kbd.textContent.trim().toUpperCase() === keyText || 
         (keyText.startsWith('F') && kbd.textContent.trim().toUpperCase() === keyText)) {
        kbd.classList.add('active-press');
        setTimeout(() => kbd.classList.remove('active-press'), 160);
      }
    });

    // Don't intercept if user is typing in form inputs
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;

    if (e.key === 'F8') {
      e.preventDefault();
      switchTab('sales');
    } else if (e.key.toLowerCase() === 'b' && !e.ctrlKey && !e.altKey) {
      switchTab('balance-sheet');
    } else if (e.key.toLowerCase() === 'p' && !e.ctrlKey && !e.altKey) {
      switchTab('profit-loss');
    } else if (e.key.toLowerCase() === 'g' && !e.ctrlKey && !e.altKey) {
      switchTab('gateway');
    }
  });

  // -------------------------------------------------------------------------
  // 3. Interactive Sales Invoice Calculator Simulator
  // -------------------------------------------------------------------------
  const qtyInput = document.getElementById('sim-qty');
  const rateInput = document.getElementById('sim-rate');
  const partySelect = document.getElementById('sim-party');
  const taxableSpan = document.getElementById('sim-taxable');
  const cgstRow = document.getElementById('sim-cgst-row');
  const sgstRow = document.getElementById('sim-sgst-row');
  const igstRow = document.getElementById('sim-igst-row');
  const cgstAmt = document.getElementById('sim-cgst');
  const sgstAmt = document.getElementById('sim-sgst');
  const igstAmt = document.getElementById('sim-igst');
  const totalSpan = document.getElementById('sim-total');

  function updateInvoiceCalculation() {
    if (!qtyInput || !rateInput) return;
    const qty = parseFloat(qtyInput.value) || 0;
    const rate = parseFloat(rateInput.value) || 0;
    const taxable = qty * rate;

    if (taxableSpan) {
      taxableSpan.textContent = '₹' + taxable.toLocaleString('en-IN', { minimumFractionDigits: 2 });
    }

    const isInterState = partySelect && partySelect.value === 'inter';

    if (isInterState) {
      if (cgstRow) cgstRow.style.display = 'none';
      if (sgstRow) sgstRow.style.display = 'none';
      if (igstRow) igstRow.style.display = 'flex';
      const igst = taxable * 0.18;
      if (igstAmt) igstAmt.textContent = '₹' + igst.toLocaleString('en-IN', { minimumFractionDigits: 2 });
      if (totalSpan) totalSpan.textContent = '₹' + (taxable + igst).toLocaleString('en-IN', { minimumFractionDigits: 2 });
    } else {
      if (cgstRow) cgstRow.style.display = 'flex';
      if (sgstRow) sgstRow.style.display = 'flex';
      if (igstRow) igstRow.style.display = 'none';
      const cgst = taxable * 0.09;
      const sgst = taxable * 0.09;
      if (cgstAmt) cgstAmt.textContent = '₹' + cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 });
      if (sgstAmt) sgstAmt.textContent = '₹' + sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 });
      if (totalSpan) totalSpan.textContent = '₹' + (taxable + cgst + sgst).toLocaleString('en-IN', { minimumFractionDigits: 2 });
    }
  }

  if (qtyInput) qtyInput.addEventListener('input', updateInvoiceCalculation);
  if (rateInput) rateInput.addEventListener('input', updateInvoiceCalculation);
  if (partySelect) partySelect.addEventListener('change', updateInvoiceCalculation);

  // -------------------------------------------------------------------------
  // 4. "Tally Tax" / Rent Extractor Slider Calculator (Creative Feature)
  // -------------------------------------------------------------------------
  const rentSlider = document.getElementById('rentYearsSlider');
  const rentYearsDisplay = document.getElementById('rentYearsDisplay');
  const tallyCostDisplay = document.getElementById('tallyCostDisplay');
  const cloudCostDisplay = document.getElementById('cloudCostDisplay');
  const savedCostDisplay = document.getElementById('savedCostDisplay');

  function updateRentCalculation() {
    if (!rentSlider) return;
    const years = parseInt(rentSlider.value, 10) || 1;
    if (rentYearsDisplay) {
      rentYearsDisplay.textContent = `${years} ${years === 1 ? 'Year' : 'Years'}`;
    }

    // Tally Silver: ~₹22,500/year (or renewals/TSS)
    const tallyTotal = years * 22500;
    // Cloud ERP (Zoho / QuickBooks): ~₹36,000/year
    const cloudTotal = years * 36000;

    if (tallyCostDisplay) {
      tallyCostDisplay.textContent = '₹' + tallyTotal.toLocaleString('en-IN');
    }
    if (cloudCostDisplay) {
      cloudCostDisplay.textContent = '₹' + cloudTotal.toLocaleString('en-IN');
    }
    if (savedCostDisplay) {
      savedCostDisplay.textContent = '₹' + tallyTotal.toLocaleString('en-IN') + ' Saved';
    }
  }

  if (rentSlider) {
    rentSlider.addEventListener('input', updateRentCalculation);
    updateRentCalculation();
  }

  // -------------------------------------------------------------------------
  // 5. Copy Verified SHA-256 Hash to Clipboard
  // -------------------------------------------------------------------------
  const copyBtn = document.getElementById('copyHashBtn');
  const hashText = document.getElementById('shaHashText');

  if (copyBtn && hashText) {
    copyBtn.addEventListener('click', function () {
      const textToCopy = hashText.textContent.trim();
      navigator.clipboard.writeText(textToCopy).then(function () {
        const originalText = copyBtn.textContent;
        copyBtn.textContent = '✓ Copied!';
        copyBtn.style.background = '#d1fae5';
        copyBtn.style.color = '#047857';
        setTimeout(function () {
          copyBtn.textContent = originalText;
          copyBtn.style.background = '';
          copyBtn.style.color = '';
        }, 2000);
      }).catch(function (err) {
        console.error('Could not copy hash: ', err);
      });
    });
  }
});
