const assert = require('assert');
const picker = require('../date_picker.js');

assert.deepStrictEqual(picker.stepMonth({year: 2026, month: 12}, 1), {year: 2027, month: 1});
assert.deepStrictEqual(picker.stepMonth({year: 2027, month: 1}, -1), {year: 2026, month: 12});
assert.strictEqual(picker.isoDate(2028, 2, 29), '2028-02-29');
assert.strictEqual(picker.isoDate(2027, 2, 29), null);
assert.strictEqual(picker.daysInMonth(2028, 2), 29);
assert.strictEqual(picker.daysInMonth(2027, 2), 28);
const current = picker.parseDate('');
const now = new Date();
assert.strictEqual(current.year, now.getFullYear());
assert.strictEqual(current.month, now.getMonth() + 1);
assert.strictEqual(current.day, now.getDate());
console.log('date picker rules: 9 assertions passed');

