const assert = require('node:assert/strict');
const rules = require('../voucher_logic.js');

assert.deepEqual(rules.modeChoices('Sales'), ['invoice', 'accounting_invoice', 'voucher']);
assert.deepEqual(rules.modeChoices('Payment'), ['voucher']);

assert.equal(rules.safeCalculate('2500*18%').display, '450');
assert.equal(rules.safeCalculate('(100+50)/3').display, '50');
assert.throws(() => rules.safeCalculate('process.exit()'), /Invalid expression/);
assert.throws(() => rules.safeCalculate('1/0'), /zero/);

assert.equal(rules.parseTallyDate('2', '2026-10-12'), '2026-10-02');
assert.equal(rules.parseTallyDate('2.11', '2026-10-12'), '2026-11-02');
assert.equal(rules.parseTallyDate('2.11.26', '2026-10-12'), '2026-11-02');
assert.equal(rules.stepTallyDate('2026-10-12', 1), '2026-10-13');
assert.equal(rules.stepTallyDate('2026-10-12', -1), '2026-10-11');
assert.equal(rules.parseTallyAmount('5k'), '5000.00');
assert.equal(rules.parseTallyAmount('5l'), '500000.00');
assert.equal(rules.parseTallyAmount('5cr'), '50000000.00');
assert.equal(rules.parseTallyAmount('=15000*18/100'), '2700.00');
assert.deepEqual(rules.normalizeAllocation('Agst Ref', '100', [
  { bill_id: 'bill-1', name: 'INV-1', amount: '60' },
  { bill_id: 'bill-2', name: 'INV-2', amount: '40' },
]), { method: 'Agst Ref', amount: '100.00', residual: '0.00', allocations: [
  { bill_id: 'bill-1', name: 'INV-1', amount: '60.00' },
  { bill_id: 'bill-2', name: 'INV-2', amount: '40.00' },
] });
assert.throws(() => rules.normalizeAllocation('Agst Ref', '100', [
  { bill_id: 'bill-1', amount: '60' },
]), /sum/);
assert.deepEqual(rules.normalizeInventoryAllocations('20', [
  { godown: 'North', batch: 'B1', expiry: '2026-12-31', quantity: '12' },
  { godown: 'South', batch: 'B2', expiry: '', quantity: '8' },
]), { quantity: '20.00', allocations: [
  { godown: 'North', batch: 'B1', expiry: '2026-12-31', quantity: '12.00' },
  { godown: 'South', batch: 'B2', expiry: '', quantity: '8.00' },
] });
assert.throws(() => rules.normalizeInventoryAllocations('20', [
  { godown: 'North', quantity: '19' },
]), /sum/);

const draft = {
  mode: 'invoice',
  headers: { party: 'Customer', narration: 'Keep me' },
  itemLines: [{ id: 'item-1', item: 'Steel', qty: '2', amount: '100.00' }],
  ledgerLines: [{ id: 'ledger-1', ledger: 'Delivery', amount: '20.00' }],
};
const switched = rules.preserveVoucherDraft(draft, 'voucher');
assert.equal(switched.mode, 'voucher');
assert.deepEqual(switched.headers, draft.headers);
assert.deepEqual(switched.itemLines, draft.itemLines);
assert.deepEqual(switched.ledgerLines, draft.ledgerLines);
assert.notEqual(switched, draft);

console.log('phase1_logic: 23 assertions passed');
