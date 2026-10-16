/* ==========================================================================
   Independent Books — Interactive 100k-Star Landing Page Script
   Handles interactive live simulator, tab switches, and clipboard actions
   ========================================================================== */

document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  // 1. Live Interactive Simulator Tab Switching
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

  // 2. Keyboard simulation in simulator (Pressing F8, B, P, G switches tabs)
  document.addEventListener('keydown', function (e) {
    // Only if not actively typing in an input
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

    if (e.key === 'F8' || (e.altKey && e.key.toLowerCase() === 'v')) {
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

  function switchTab(name) {
    const btn = document.querySelector(`.sim-tab-btn[data-tab="${name}"]`);
    if (btn) btn.click();
  }

  // 3. Interactive Sales Invoice Calculator Simulator
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

    if (taxableSpan) taxableSpan.textContent = '₹' + taxable.toLocaleString('en-IN', { minimumFractionDigits: 2 });

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

  // 4. Copy Checksum to Clipboard
  const copyBtn = document.getElementById('copyHashBtn');
  const hashText = document.getElementById('shaHashText');

  if (copyBtn && hashText) {
    copyBtn.addEventListener('click', function () {
      const text = hashText.textContent.trim();
      navigator.clipboard.writeText(text).then(() => {
        const orig = copyBtn.textContent;
        copyBtn.textContent = '✓ Copied!';
        copyBtn.style.color = '#10b981';
        setTimeout(() => {
          copyBtn.textContent = orig;
          copyBtn.style.color = '';
        }, 2000);
      });
    });
  }
});
