const assert = require('node:assert/strict');
const printView = require('../print_view.js');

const voucher = {
  VOUCHERTYPENAME: 'Sales', VOUCHERNUMBER: 'S-1', DATE: '20260415',
  PARTYLEDGERNAME: 'Customer', NARRATION: 'Printed cleanly', BANKDATE: '20260416',
  'ALLINVENTORYENTRIES.LIST': [{
    STOCKITEMNAME: 'Steel', ACTUALQTY: '2 pcs', ALTQTY: '3 boxes', RATE: '100/pcs',
    AMOUNT: '200.00', GODOWNNAME: 'Hidden Location',
  }],
  'ALLLEDGERENTRIES.LIST': [
    {LEDGERNAME: 'Customer', AMOUNT: '-236.00', ISDEEMEDPOSITIVE: 'No'},
    {LEDGERNAME: 'Sales', AMOUNT: '200.00', ISDEEMEDPOSITIVE: 'Yes'},
  ],
};

const model = printView.buildVoucherPrintModel(voucher, {name: 'Print Test Co'}, null);
assert.equal(model.party, 'Customer');
assert.deepEqual(model.items[0], {
  item: 'Steel', quantity: '2 pcs', alternate_quantity: '3 boxes', rate: '100/pcs', amount: '200.00'
});
assert.equal(model.bank_date, undefined);
assert.equal(model.items[0].godown, undefined);
assert.equal(model.narration, 'Printed cleanly');
console.log('print_view: 5 assertions passed');

// Test modular layout settings
const customSettings = {
  borderMode: 'borderless',
  documentTitle: 'Bill of Supply',
  showBankDetails: false,
  showSignatory: true,
};
const customModel = printView.buildVoucherPrintModel(voucher, {name: 'Print Test Co', bank_name: 'HDFC Bank'}, null, customSettings);
assert.equal(customModel.settings.borderMode, 'borderless');
assert.equal(customModel.settings.documentTitle, 'Bill of Supply');
assert.equal(customModel.settings.showBankDetails, false);

const html = printView.renderVoucherPrint ? printView.renderVoucherPrint(customModel) : '';
assert.match(html, /borderless/);
assert.match(html, /Bill of Supply/);
assert.doesNotMatch(html, /HDFC Bank/);
assert.match(html, /Authorised signatory/);

// Test boxed layout with bank details
const boxedModel = printView.buildVoucherPrintModel(voucher, {name: 'Print Test Co', bank_name: 'HDFC Bank'}, null, {borderMode: 'boxed', showBankDetails: true});
const boxedHtml = printView.renderVoucherPrint ? printView.renderVoucherPrint(boxedModel) : '';
assert.match(boxedHtml, /boxed/);
assert.match(boxedHtml, /HDFC Bank/);

// Test additional charges in print invoice (e.g. delivery, freight)
const voucherWithDelivery = {
  VOUCHERTYPENAME: 'Sales', VOUCHERNUMBER: 'S-2', DATE: '20261015',
  PARTYLEDGERNAME: 'Raj Traders', NARRATION: 'Urgent delivery',
  'ALLINVENTORYENTRIES.LIST': [{
    STOCKITEMNAME: 'Steel Rods', ACTUALQTY: '1 pcs', RATE: '100/pcs',
    AMOUNT: '100.00'
  }],
  'ALLLEDGERENTRIES.LIST': [
    {LEDGERNAME: 'Raj Traders', AMOUNT: '-110.00', ISDEEMEDPOSITIVE: 'No'},
    {LEDGERNAME: 'Sales', AMOUNT: '100.00', ISDEEMEDPOSITIVE: 'Yes'},
    {LEDGERNAME: 'delivery', AMOUNT: '10.00', ISDEEMEDPOSITIVE: 'Yes'},
  ],
};
const deliveryModel = printView.buildVoucherPrintModel(voucherWithDelivery, {name: 'Steel Corp'}, null);
assert.equal(deliveryModel.total_amount, '110.00');
assert.equal(deliveryModel.amount_in_words, 'INR One Hundred Ten Only');
assert.equal(deliveryModel.additional_ledgers.length, 1);
assert.equal(deliveryModel.additional_ledgers[0].ledger, 'delivery');
assert.equal(deliveryModel.additional_ledgers[0].amount, '10.00');

const deliveryHtml = printView.renderVoucherPrint(deliveryModel);
assert.match(deliveryHtml, /delivery/);
assert.match(deliveryHtml, /110\.00/);
assert.match(deliveryHtml, /INR One Hundred Ten Only/);

console.log('print_view: all 19 assertions passed');

