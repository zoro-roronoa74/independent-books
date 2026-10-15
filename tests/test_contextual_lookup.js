'use strict';
const assert = require('node:assert/strict');
const {effectiveSystemGroup, lookupContext, lookupOptions} = require('../lookup_context.js');

const data = {
  group_records: {
    'Current Assets': {name: 'Current Assets', parent: 'Primary'},
    'Current Liabilities': {name: 'Current Liabilities', parent: 'Primary'},
    'Sundry Debtors': {name: 'Sundry Debtors', parent: 'Current Assets', system_group: 'Sundry Debtors'},
    'Sundry Creditors': {name: 'Sundry Creditors', parent: 'Current Liabilities', system_group: 'Sundry Creditors'},
    'Retail Debtors': {name: 'Retail Debtors', parent: 'Sundry Debtors'},
    'Trade Creditors': {name: 'Trade Creditors', parent: 'Sundry Creditors'},
    'Regional Sales': {name: 'Regional Sales', parent: 'Sales Accounts'},
    'Regional Purchases': {name: 'Regional Purchases', parent: 'Purchase Accounts'},
    'Freight Expenses': {name: 'Freight Expenses', parent: 'Indirect Expenses'},
    'Bank Accounts': {name: 'Bank Accounts', parent: 'Current Assets', system_group: 'Bank Accounts'},
    'Cash-in-hand': {name: 'Cash-in-hand', parent: 'Current Assets', system_group: 'Cash-in-hand'},
    'Sales Accounts': {name: 'Sales Accounts', parent: 'Primary'},
    'Purchase Accounts': {name: 'Purchase Accounts', parent: 'Primary'},
    'Indirect Expenses': {name: 'Indirect Expenses', parent: 'Primary'},
    'Indirect Incomes': {name: 'Indirect Incomes', parent: 'Primary'},
    'Direct Expenses': {name: 'Direct Expenses', parent: 'Primary'},
    'Direct Incomes': {name: 'Direct Incomes', parent: 'Primary'},
    'Duties & Taxes': {name: 'Duties & Taxes', parent: 'Current Liabilities', system_group: 'Duties & Taxes'},
  },
  ledgers: {
    Customer: {name: 'Customer', parent: 'Retail Debtors', alias: 'Acme'},
    Supplier: {name: 'Supplier', parent: 'Trade Creditors'},
    Sales: {name: 'Sales', parent: 'Sales Accounts'},
    'Regional Sales Ledger': {name: 'Regional Sales Ledger', parent: 'Regional Sales'},
    Purchase: {name: 'Purchase', parent: 'Purchase Accounts'},
    'Regional Purchase Ledger': {name: 'Regional Purchase Ledger', parent: 'Regional Purchases'},
    Freight: {name: 'Freight', parent: 'Freight Expenses'},
    Discount: {name: 'Discount', parent: 'Direct Expenses'},
    Income: {name: 'Income', parent: 'Indirect Incomes'},
    Bank: {name: 'Bank', parent: 'Bank Accounts'},
    Cash: {name: 'Cash', parent: 'Cash-in-hand'},
    CGST: {name: 'CGST', parent: 'Duties & Taxes'},
    Unrelated: {name: 'Unrelated', parent: 'Current Assets'},
    'Unrelated Billwise': {name: 'Unrelated Billwise', parent: 'Current Assets', is_billwise: 'Yes'},
  },
  stock_items: {
    Steel: {name: 'Steel', alias: 'MS sheet', parent: 'Raw Materials'},
    'Other Item': {name: 'Other Item', parent: 'Finished Goods'},
  },
  stock_groups: ['Raw Materials', 'Finished Goods'],
  stock_categories: [],
};

function names(context, query = '') {
  return lookupOptions(data, context, query).map(option => option.name);
}

assert.equal(effectiveSystemGroup(data, 'Retail Debtors'), 'Sundry Debtors');
assert.equal(effectiveSystemGroup(data, 'Regional Sales'), 'Sales Accounts');

const salesParty = lookupContext(data, {base: 'Sales', field: 'party'});
assert.equal(salesParty.create.label, 'Create Party Ledger');
assert.equal(salesParty.create.parent, 'Sundry Debtors');
assert.deepEqual(names(salesParty), ['Customer']);

const purchaseNoteParty = lookupContext(data, {base: 'Debit Note', field: 'party'});
assert.deepEqual(names(purchaseNoteParty), ['Supplier']);

const salesAccount = lookupContext(data, {base: 'Sales', field: 'account'});
assert.deepEqual(names(salesAccount), ['Regional Sales Ledger', 'Sales']);

const purchaseAccount = lookupContext(data, {base: 'Purchase', field: 'account'});
assert.equal(purchaseAccount.create.parent, 'Purchase Accounts');
assert.deepEqual(names(purchaseAccount), ['Purchase', 'Regional Purchase Ledger']);

const extra = lookupContext(data, {base: 'Sales', field: 'ledger', rowType: 'extra'});
assert.deepEqual(extra.createOptions.map(option => option.label), ['Create Expense Ledger', 'Create Income Ledger']);
assert.deepEqual(names(extra), ['Discount', 'Freight', 'Income']);

const bank = lookupContext(data, {base: 'Payment', field: 'payment_bank'});
const party = lookupContext(data, {base: 'Payment', field: 'party'});
assert.deepEqual(names(bank), ['Bank', 'Cash']);
assert.deepEqual(names(party), ['Customer', 'Supplier']);
assert.ok(new Set(names(bank)).isDisjointFrom(new Set(names(party))));

const items = lookupContext(data, {base: 'Sales', field: 'item'});
assert.equal(items.kind, 'stock_item');
assert.equal(items.create.label, 'Create Item');
assert.deepEqual(names(items, 'sheet'), ['Steel']);

const selectedFirst = lookupOptions(data, lookupContext(data, {base: 'Sales', field: 'account', selected: 'Sales'}), '').map(option => option.name);
assert.deepEqual(selectedFirst, ['Sales', 'Regional Sales Ledger']);

const substringMatch = lookupOptions(data, lookupContext(data, {base: 'Sales', field: 'account'}), 'gion').map(option => option.name);
assert.deepEqual(substringMatch, ['Regional Sales Ledger']);

console.log('contextual lookup assertions passed');
