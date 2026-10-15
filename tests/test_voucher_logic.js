const assert = require('node:assert/strict');
const rules = require('../voucher_logic.js');

assert.equal(rules.shouldAdvanceSelect({ value: 'JT Steel Tube' }), true);
assert.equal(rules.shouldAdvanceSelect({ value: '' }), false);
assert.deepEqual(rules.paymentEntryOrder(), ['bank', 'party', 'amount', 'reference']);
assert.equal(rules.shouldAppendInvoiceRow({ item: 'CRC Sheet', qty: '2', rate: '100', amount: '200.00' }), true);
assert.equal(rules.shouldAppendInvoiceRow({ item: 'CRC Sheet', qty: '', rate: '100', amount: '' }), false);
assert.deepEqual(rules.adjustmentLedgers(), ['Discount', 'Freight / Delivery Charges', 'Rounding Off']);
assert.equal(rules.evaluateBillingFormula('qty * rate * (1 - discount%)', {qty: '2', rate: '100', discount: '10'}), '180.00');
assert.equal(rules.evaluateBillingFormula('alt_qty * rate', {alt_qty: '3', rate: '10'}), '30.00');
console.log('voucher_logic: 8 assertions passed');
