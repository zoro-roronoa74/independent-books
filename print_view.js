'use strict';

function printList(voucher, key='ALLLEDGERENTRIES.LIST') {
  const value=voucher[key]||(key==='ALLLEDGERENTRIES.LIST'?voucher['LEDGERENTRIES.LIST']:[] )||[];
  return Array.isArray(value)?value:[value];
}

function printDate(value) {
  const source=String(value||'');
  if(!/^\d{8}$/.test(source))return source;
  return `${source.slice(6)}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(source.slice(4,6))-1]}-${source.slice(0,4)}`;
}

function numberToWords(num) {
  if (isNaN(num) || num <= 0) return 'INR Zero Only';
  const units = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertBelowThousand(n) {
    let str = '';
    if (n >= 100) {
      str += units[Math.floor(n / 100)] + ' Hundred ';
      n %= 100;
    }
    if (n >= 20) {
      str += tens[Math.floor(n / 10)] + (n % 10 ? ' ' + units[n % 10] : '');
    } else if (n > 0) {
      str += units[n];
    }
    return str.trim();
  }

  const parts = Number(num).toFixed(2).split('.');
  let integerPart = parseInt(parts[0], 10);
  const paise = parseInt(parts[1], 10);

  let words = '';
  if (integerPart >= 10000000) {
    const crore = Math.floor(integerPart / 10000000);
    words += convertBelowThousand(crore) + ' Crore ';
    integerPart %= 10000000;
  }
  if (integerPart >= 100000) {
    const lakh = Math.floor(integerPart / 100000);
    words += convertBelowThousand(lakh) + ' Lakh ';
    integerPart %= 100000;
  }
  if (integerPart >= 1000) {
    const thousand = Math.floor(integerPart / 1000);
    words += convertBelowThousand(thousand) + ' Thousand ';
    integerPart %= 1000;
  }
  if (integerPart > 0) {
    words += convertBelowThousand(integerPart) + ' ';
  }
  words = words.trim() || 'Zero';
  let result = 'INR ' + words;
  if (paise > 0) {
    result += ' and ' + convertBelowThousand(paise) + ' Paise';
  }
  return result + ' Only';
}

const defaultPrintSettings = {
  borderMode: 'boxed',
  showCompanyAddress: true,
  showGstin: true,
  showBuyerAddress: true,
  showHsn: true,
  showGstBreakup: true,
  showBankDetails: true,
  showAmountInWords: true,
  showTerms: true,
  showSignatory: true,
  documentTitle: 'Tax Invoice',
};

function buildVoucherPrintModel(voucher, company, profile, layoutSettings = {}) {
  const items = printList(voucher, 'ALLINVENTORYENTRIES.LIST').map(row => {
    const item = {
      item: row.STOCKITEMNAME || '',
      quantity: row.ACTUALQTY || row.BILLEDQTY || '',
      alternate_quantity: row.ALTQTY || '',
      rate: row.RATE || '',
      amount: row.AMOUNT || ''
    };
    if (row.HSNCODE || row.HSN) item.hsn = row.HSNCODE || row.HSN;
    return item;
  });
  const ledgers = printList(voucher).map(row => ({
    ledger: row.LEDGERNAME || '',
    amount: row.AMOUNT || '',
    side: row.ISDEEMEDPOSITIVE === 'Yes' ? 'Dr' : 'Cr'
  }));

  const partyName = voucher.PARTYLEDGERNAME || '';
  const accountName = voucher.ACCOUNTNAME || '';

  const isTax = l => /cgst|sgst|igst|tax|duty/i.test(l.ledger);
  const isParty = l => partyName && l.ledger.trim().toLowerCase() === partyName.trim().toLowerCase();
  const isMainAccount = l => {
    if (accountName) return l.ledger.trim().toLowerCase() === accountName.trim().toLowerCase();
    const clean = l.ledger.trim().toLowerCase();
    return clean === 'sales' || clean === 'sales account' || clean === 'purchase' || clean === 'purchase account';
  };

  const taxLedgers = ledgers.filter(isTax);
  const additionalLedgers = ledgers.filter(l => !isTax(l) && !isParty(l) && !isMainAccount(l));

  const settings = Object.assign({}, defaultPrintSettings, {
    documentTitle: voucher.VOUCHERTYPENAME === 'Sales' ? 'Tax Invoice' : (voucher.VOUCHERTYPENAME || 'Voucher')
  }, layoutSettings || {});

  const companyInfo = {
    name: company?.name || '',
    address: company?.address || '',
    gstin: company?.gstin || company?.gst_number || '',
    state: company?.state || '',
    bank_name: company?.bank_name || '',
    account_no: company?.account_no || company?.account_number || '',
    ifsc: company?.ifsc || company?.ifsc_code || '',
    branch: company?.branch || '',
    terms: company?.terms || '1. Goods once sold will not be taken back.\n2. Interest @ 18% p.a. will be charged if payment not made within due date.'
  };

  const partyInfo = {
    name: voucher.PARTYLEDGERNAME || '',
    address: voucher.PARTYADDRESS || voucher.ADDRESS || '',
    gstin: voucher.PARTYGSTIN || voucher.GSTIN || '',
    state: voucher.PARTYSTATE || voucher.STATE || ''
  };

  let totalNum = 0;
  if (items.length) {
    const itemsTotal = items.reduce((sum, it) => {
      const val = parseFloat(String(it.amount || '0').replace(/,/g, ''));
      return sum + (isNaN(val) ? 0 : val);
    }, 0);
    const taxNum = taxLedgers.reduce((sum, l) => {
      const val = parseFloat(String(l.amount || '0').replace(/,/g, ''));
      return sum + (isNaN(val) ? 0 : Math.abs(val));
    }, 0);
    const extrasNum = additionalLedgers.reduce((sum, l) => {
      const val = parseFloat(String(l.amount || '0').replace(/,/g, ''));
      return sum + (isNaN(val) ? 0 : Math.abs(val));
    }, 0);
    totalNum = itemsTotal + extrasNum + taxNum;
  } else if (ledgers.length) {
    const dr = ledgers.find(l => l.side === 'Dr');
    totalNum = dr ? Math.abs(parseFloat(dr.amount) || 0) : 0;
  }

  const totalAmountStr = totalNum.toFixed(2);

  return {
    kind: 'voucher',
    company: company?.name || '',
    company_info: companyInfo,
    voucher_type: voucher.VOUCHERTYPENAME || '',
    number: voucher.VOUCHERNUMBER || '',
    date: printDate(voucher.DATE),
    party: voucher.PARTYLEDGERNAME || '',
    party_info: partyInfo,
    items,
    ledgers,
    additional_ledgers: additionalLedgers,
    narration: voucher.NARRATION || '',
    profile: profile?.formula || '',
    total_amount: totalAmountStr,
    amount_in_words: numberToWords(totalNum),
    settings
  };
}

function escapePrint(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderVoucherPrint(model) {
  const s = model.settings || defaultPrintSettings;
  const borderClass = s.borderMode === 'borderless' ? 'borderless' : 'boxed';
  const c = model.company_info || { name: model.company };
  const p = model.party_info || { name: model.party };

  let headerHtml = `
    <header class="print-header">
      <div class="print-doc-title">${escapePrint(s.documentTitle || model.voucher_type || 'Tax Invoice')}</div>
      <div class="print-header-grid">
        <div class="print-company-block">
          <h1 class="print-company-name">${escapePrint(model.company || c.name)}</h1>
          ${s.showCompanyAddress && c.address ? `<div class="print-address">${escapePrint(c.address)}</div>` : ''}
          ${s.showGstin && c.gstin ? `<div class="print-gstin"><strong>GSTIN:</strong> ${escapePrint(c.gstin)}</div>` : ''}
          ${c.state ? `<div class="print-state"><strong>State:</strong> ${escapePrint(c.state)}</div>` : ''}
        </div>
        <div class="print-meta-block">
          <div class="print-meta-row"><strong>Invoice No:</strong> ${escapePrint(model.number || '-')}</div>
          <div class="print-meta-row"><strong>Date:</strong> ${escapePrint(model.date || '-')}</div>
          ${model.voucher_type ? `<div class="print-meta-row"><strong>Voucher Type:</strong> ${escapePrint(model.voucher_type)}</div>` : ''}
        </div>
      </div>
      ${(s.showBuyerAddress || model.party) ? `
      <div class="print-buyer-grid">
        <div class="print-buyer-block">
          <div class="print-buyer-label">Buyer / Consignee:</div>
          <div class="print-party-name">${escapePrint(model.party || p.name)}</div>
          ${s.showBuyerAddress && p.address ? `<div class="print-address">${escapePrint(p.address)}</div>` : ''}
          ${s.showGstin && p.gstin ? `<div class="print-gstin"><strong>GSTIN:</strong> ${escapePrint(p.gstin)}</div>` : ''}
          ${p.state ? `<div class="print-state"><strong>State:</strong> ${escapePrint(p.state)}</div>` : ''}
        </div>
      </div>` : ''}
    </header>
  `;

  let tableHtml = '';
  if (model.items && model.items.length) {
    const hasAlt = model.items.some(i => i.alternate_quantity);
    const hasHsn = s.showHsn && model.items.some(i => i.hsn);
    let thead = `<tr><th>#</th><th>Description of Goods</th>${hasHsn ? '<th>HSN/SAC</th>' : ''}<th>Quantity</th>${hasAlt ? '<th>Alt Quantity</th>' : ''}<th class="amount">Rate</th><th class="amount">Amount</th></tr>`;
    let tbody = model.items.map((row, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td><strong>${escapePrint(row.item)}</strong></td>
        ${hasHsn ? `<td>${escapePrint(row.hsn || '')}</td>` : ''}
        <td>${escapePrint(row.quantity)}</td>
        ${hasAlt ? `<td>${escapePrint(row.alternate_quantity)}</td>` : ''}
        <td class="amount">${escapePrint(row.rate)}</td>
        <td class="amount">${escapePrint(row.amount)}</td>
      </tr>
    `).join('');

    if (model.additional_ledgers && model.additional_ledgers.length) {
      const colSpan = 3 + (hasHsn ? 1 : 0) + (hasAlt ? 1 : 0);
      model.additional_ledgers.forEach(al => {
        const amt = parseFloat(al.amount);
        tbody += `
          <tr class="print-additional-row">
            <td colspan="${colSpan}" style="text-align:right"><strong>${escapePrint(al.ledger)}</strong></td>
            <td class="amount" colspan="2"><strong>${escapePrint(Math.abs(amt).toFixed(2))}</strong></td>
          </tr>
        `;
      });
    }

    if (s.showGstBreakup && model.ledgers) {
      const taxLedgers = model.ledgers.filter(l => /cgst|sgst|igst|tax|duty/i.test(l.ledger));
      taxLedgers.forEach(tl => {
        const amt = parseFloat(tl.amount);
        const colSpan = 3 + (hasHsn ? 1 : 0) + (hasAlt ? 1 : 0);
        tbody += `
          <tr class="print-tax-row">
            <td colspan="${colSpan}" style="text-align:right"><strong>${escapePrint(tl.ledger)}</strong></td>
            <td class="amount" colspan="2"><strong>${escapePrint(Math.abs(amt).toFixed(2))}</strong></td>
          </tr>
        `;
      });
    }

    const colSpan = 3 + (hasHsn ? 1 : 0) + (hasAlt ? 1 : 0);
    tbody += `
      <tr class="print-total-row">
        <td colspan="${colSpan}" style="text-align:right"><strong>Total:</strong></td>
        <td class="amount" colspan="2"><strong>₹ ${escapePrint(model.total_amount || '')}</strong></td>
      </tr>
    `;

    tableHtml = `<table class="print-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
  } else if (model.ledgers && model.ledgers.length) {
    let thead = `<tr><th>Particulars</th><th>Dr/Cr</th><th class="amount">Amount</th></tr>`;
    let tbody = model.ledgers.map(row => `
      <tr>
        <td>${escapePrint(row.ledger)}</td>
        <td>${escapePrint(row.side)}</td>
        <td class="amount">${escapePrint(row.amount)}</td>
      </tr>
    `).join('');
    tableHtml = `<table class="print-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
  }

  let footerHtml = `
    <footer class="print-footer">
      ${s.showAmountInWords && model.amount_in_words ? `
      <div class="print-amount-words">
        <strong>Amount Chargeable (in words):</strong> ${escapePrint(model.amount_in_words)}
      </div>` : ''}
      <div class="print-footer-grid">
        ${s.showBankDetails && (c.bank_name || c.account_no) ? `
        <div class="print-bank-details">
          <div class="print-section-title">Company's Bank Details</div>
          ${c.bank_name ? `<div><strong>Bank Name:</strong> ${escapePrint(c.bank_name)}</div>` : ''}
          ${c.account_no ? `<div><strong>A/c No.:</strong> ${escapePrint(c.account_no)}</div>` : ''}
          ${(c.branch || c.ifsc) ? `<div><strong>Branch & IFS Code:</strong> ${escapePrint(c.branch)} ${escapePrint(c.ifsc)}</div>` : ''}
        </div>` : '<div class="print-bank-details"></div>'}
        ${s.showSignatory ? `
        <div class="print-signatory-block">
          <div class="print-for-company">for <strong>${escapePrint(model.company || c.name)}</strong></div>
          <div class="print-sign-space"></div>
          <div class="print-auth-text">Authorised signatory</div>
        </div>` : ''}
      </div>
      ${s.showTerms && c.terms ? `
      <div class="print-terms-block">
        <div class="print-section-title">Declaration / Terms & Conditions:</div>
        <div class="print-terms-text">${escapePrint(c.terms).replace(/\n/g, '<br>')}</div>
      </div>` : ''}
    </footer>
  `;

  return `
    <article class="print-voucher ${borderClass}">
      ${headerHtml}
      ${tableHtml}
      ${model.narration ? `<p class="print-narration"><strong>Narration:</strong> ${escapePrint(model.narration)}</p>` : ''}
      ${footerHtml}
    </article>
  `;
}

function renderPrintDocument(model) {
  if (typeof document === 'undefined') return null;
  const root = document.createElement('div');
  root.className = 'print-root';
  root.innerHTML = model.kind === 'voucher' ? renderVoucherPrint(model) : model.html || '';
  return root;
}

function buildReportPrintModel(reportRoot) {
  return { kind: 'report', html: reportRoot?.outerHTML || '' };
}

const printViewApi = {
  buildReportPrintModel,
  buildVoucherPrintModel,
  renderPrintDocument,
  renderVoucherPrint,
  defaultPrintSettings,
  numberToWords
};

if (typeof module !== 'undefined' && module.exports) module.exports = printViewApi;
if (typeof window !== 'undefined') window.IndependentPrintView = printViewApi;
