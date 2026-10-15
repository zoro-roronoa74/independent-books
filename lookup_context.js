'use strict';

(function (root) {
  const SYSTEM_GROUPS = new Set([
    'Sundry Debtors', 'Sundry Creditors', 'Sales Accounts', 'Purchase Accounts',
    'Direct Expenses', 'Indirect Expenses', 'Direct Incomes', 'Indirect Incomes',
    'Cash-in-hand', 'Bank Accounts', 'Bank OCC A/c', 'Bank OD A/c', 'Duties & Taxes'
  ]);
  const BANK_GROUPS = new Set(['Cash-in-hand', 'Bank Accounts', 'Bank OCC A/c', 'Bank OD A/c']);
  const NOMINAL_GROUPS = new Set(['Direct Expenses', 'Indirect Expenses', 'Direct Incomes', 'Indirect Incomes']);
  const GROUP_PARENTS = {
    'Cash-in-hand': 'Current Assets',
    'Bank Accounts': 'Current Assets',
    'Bank OCC A/c': 'Loans (Liability)',
    'Bank OD A/c': 'Loans (Liability)',
    'Sundry Debtors': 'Current Assets',
    'Sundry Creditors': 'Current Liabilities',
    'Sales Accounts': 'Primary',
    'Purchase Accounts': 'Primary',
    'Direct Expenses': 'Primary',
    'Indirect Expenses': 'Primary',
    'Direct Incomes': 'Primary',
    'Indirect Incomes': 'Primary',
    'Duties & Taxes': 'Current Liabilities'
  };

  function recordsFor(data) {
    return data?.group_records || {};
  }

  function effectiveSystemGroup(data, groupName) {
    let group = String(groupName || '');
    const records = recordsFor(data);
    const seen = new Set();
    while (group && !seen.has(group) && group !== 'Primary') {
      seen.add(group);
      const record = records[group] || {};
      const classification = record.system_group || (SYSTEM_GROUPS.has(group) ? group : '');
      if (classification) return classification;
      group = record.parent || GROUP_PARENTS[group] || '';
    }
    return '';
  }

  function ledgerClassification(data, record) {
    return String(record?.system_group || record?.group_type || effectiveSystemGroup(data, record?.parent) || '');
  }

  function isYes(value) {
    return String(value || '').toLowerCase() === 'yes';
  }

  function partyClass(data, record) {
    const classification = ledgerClassification(data, record);
    if (classification === 'Sundry Debtors') return 'debtor';
    if (classification === 'Sundry Creditors') return 'creditor';
    return '';
  }

  function createOption(label, parent, kind = 'ledger') {
    return {label, parent, kind};
  }

  function finishContext(context) {
    context.create = context.createOptions[0];
    return context;
  }

  function lookupContext(data, {base = '', field = '', rowType = '', selected = '', accountName = '', partyName = ''} = {}) {
    const normalizedBase = String(base || '');
    const normalizedField = String(field || '');
    const isPayment = normalizedBase === 'Payment' || normalizedBase === 'Receipt';
    const context = {
      base: normalizedBase,
      field: normalizedField,
      rowType,
      selected,
      accountName,
      partyName,
      kind: 'ledger',
      title: 'Ledgers',
      groupClasses: [],
      partyClasses: [],
      bankOnly: false,
      partyOnly: false,
      nominalOnly: false,
      excludeNames: new Set(),
      createOptions: [createOption('Create Ledger', 'Primary')]
    };

    if (normalizedField === 'item' || rowType === 'item') {
      context.kind = 'stock_item';
      context.title = 'Stock Items';
      context.createOptions = [createOption('Create Item', '', 'stock_item')];
      return finishContext(context);
    }

    if (normalizedField === 'payment_bank' || normalizedField === 'bank') {
      context.title = 'Bank / Cash Ledgers';
      context.bankOnly = true;
      context.createOptions = [createOption('Create Bank / Cash Ledger', 'Bank Accounts')];
      return finishContext(context);
    }

    if (normalizedField === 'party') {
      const isPurchaseParty = normalizedBase === 'Purchase' || normalizedBase === 'Debit Note';
      context.title = isPayment ? 'Party Ledgers' : isPurchaseParty ? 'Suppliers' : 'Customers';
      context.partyOnly = true;
      context.partyClasses = isPayment ? ['debtor', 'creditor'] : [isPurchaseParty ? 'creditor' : 'debtor'];
      context.createOptions = isPayment
        ? [createOption('Create Customer Ledger', 'Sundry Debtors'), createOption('Create Supplier Ledger', 'Sundry Creditors')]
        : [createOption('Create Party Ledger', isPurchaseParty ? 'Sundry Creditors' : 'Sundry Debtors')];
      return finishContext(context);
    }

    if (normalizedField === 'account') {
      const group = normalizedBase === 'Purchase' || normalizedBase === 'Debit Note' ? 'Purchase Accounts' : 'Sales Accounts';
      context.title = group === 'Purchase Accounts' ? 'Purchase Ledgers' : 'Sales Ledgers';
      context.groupClasses = [group];
      context.createOptions = [createOption(group === 'Purchase Accounts' ? 'Create Purchase Ledger' : 'Create Sales Ledger', group)];
      return finishContext(context);
    }

    if (rowType === 'extra' || normalizedField === 'extra_ledger') {
      context.title = 'Expense / Income Ledgers';
      context.nominalOnly = true;
      context.createOptions = [createOption('Create Expense Ledger', 'Indirect Expenses'), createOption('Create Income Ledger', 'Indirect Incomes')];
      context.excludeNames = new Set([partyName, accountName, 'CGST', 'SGST', 'IGST']);
      return finishContext(context);
    }

    context.title = isPayment ? 'Payment Ledgers' : 'Accounting Ledgers';
    context.excludeNames = new Set([partyName, accountName]);
    return finishContext(context);
  }

  function optionRecord(data, kind, name) {
    if (kind === 'stock_item') return data?.stock_items?.[name] || {name};
    return data?.ledgers?.[name] || {name};
  }

  function matchesContext(data, context, name, record) {
    if (context.excludeNames?.has(name)) return false;
    if (context.kind === 'stock_item') return true;
    const classification = ledgerClassification(data, record);
    if (context.bankOnly) return BANK_GROUPS.has(classification);
    if (context.partyOnly) {
      const kind = partyClass(data, record);
      return context.partyClasses.includes(kind);
    }
    if (context.nominalOnly) return NOMINAL_GROUPS.has(classification) && !BANK_GROUPS.has(classification);
    if (context.groupClasses.length) return context.groupClasses.includes(classification);
    return true;
  }

  function searchText(data, context, name, record) {
    const values = [name, record.alias, record.parent, record.category];
    if (context.kind !== 'stock_item') values.push(ledgerClassification(data, record));
    return values.filter(Boolean).join(' ').toLowerCase();
  }

  function lookupOptions(data, context, query = '') {
    const source = context.kind === 'stock_item' ? data?.stock_items || {} : data?.ledgers || {};
    const needle = String(query || '').trim().toLowerCase();
    const options = Object.entries(source)
      .filter(([name, record]) => matchesContext(data, context, name, record))
      .filter(([name, record]) => !needle || searchText(data, context, name, record).includes(needle))
      .map(([name, record]) => ({
        name,
        value: name,
        detail: context.kind === 'stock_item' ? [record.closing_qty || record.opening_qty || '0', record.base_units].filter(Boolean).join(' ') : (record.parent || ledgerClassification(data, record)),
        selected: name === context.selected
      }))
      .sort((left, right) => {
        if (left.selected !== right.selected) return left.selected ? -1 : 1;
        return left.name.localeCompare(right.name, undefined, {sensitivity: 'base'});
      });
    return options;
  }

  const api = {effectiveSystemGroup, lookupContext, lookupOptions};
  root.IndependentLookupContext = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
