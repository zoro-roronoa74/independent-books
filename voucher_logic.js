'use strict';

function shouldAdvanceSelect(control) {
  return Boolean(control && String(control.value || '').trim());
}

function paymentEntryOrder() {
  return ['bank', 'party', 'amount', 'reference'];
}

function shouldAppendInvoiceRow(row) {
  return Boolean(
    row &&
    String(row.item || '').trim() &&
    String(row.qty || '').trim() &&
    String(row.rate || '').trim() &&
    String(row.amount || '').trim()
  );
}

function adjustmentLedgers() {
  return ['Discount', 'Freight / Delivery Charges', 'Rounding Off'];
}

function balanceFromLedger(ledger) {
  if (!ledger) return { amount: '0.00', drcr: 'Dr' };
  const signed = Number(ledger.signed_closing ?? 0);
  const amount = Math.abs(signed || Number(ledger.closing_balance || 0));
  return {
    amount: amount.toFixed(2),
    drcr: ledger.closing_drcr || (signed < 0 ? 'Cr' : 'Dr'),
  };
}

function gstComponents(taxableAmount, rate, sameState = true) {
  const taxable = Math.round(Number(taxableAmount || 0) * 100) / 100;
  const taxRate = Number(rate || 0);
  if (!(taxable > 0) || !(taxRate > 0)) return [];
  const total = Math.round(taxable * taxRate) / 100;
  if (!sameState) return [{ ledger: 'IGST', amount: total.toFixed(2), rate: taxRate.toFixed(2) }];
  const halfRate = taxRate / 2;
  const cgst = Math.round(total * 50) / 100;
  const sgst = Math.round((total - cgst) * 100) / 100;
  return [
    { ledger: 'CGST', amount: cgst.toFixed(2), rate: halfRate.toFixed(2) },
    { ledger: 'SGST', amount: sgst.toFixed(2), rate: halfRate.toFixed(2) },
  ];
}

function safeCalculate(expression) {
  const source = String(expression || '').replace(/\s+/g, '');
  if (!source) throw new Error('Invalid expression');
  let index = 0;
  const peek = () => source[index] || '';
  const consume = (token) => {
    if (source.slice(index, index + token.length) !== token) return false;
    index += token.length;
    return true;
  };
  const number = () => {
    const start = index;
    while (/\d|\./.test(peek())) index += 1;
    const text = source.slice(start, index);
    if (!text || (text.match(/\./g) || []).length > 1 || text === '.') {
      throw new Error('Invalid expression');
    }
    return Number(text);
  };
  const primary = () => {
    if (consume('(')) {
      const value = additive();
      if (!consume(')')) throw new Error('Invalid expression');
      return value;
    }
    if (!/\d|\./.test(peek())) throw new Error('Invalid expression');
    return number();
  };
  const unary = () => {
    if (consume('+')) return unary();
    if (consume('-')) return -unary();
    return primary();
  };
  const postfix = () => {
    let value = unary();
    while (consume('%')) value /= 100;
    return value;
  };
  const multiplicative = () => {
    let value = postfix();
    while (peek() === '*' || peek() === '/') {
      const operator = source[index++];
      const right = postfix();
      if (operator === '/' && right === 0) throw new Error('Division by zero');
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  };
  function additive() {
    let value = multiplicative();
    while (peek() === '+' || peek() === '-') {
      const operator = source[index++];
      const right = multiplicative();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }
  const value = additive();
  if (index !== source.length || !Number.isFinite(value)) throw new Error('Invalid expression');
  const rounded = Math.round((value + Number.EPSILON) * 100000000) / 100000000;
  return { value: rounded, display: String(rounded).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1') };
}

function parseTallyDate(input, referenceDate = new Date()) {
  const source = String(input || '').trim();
  const reference = referenceDate instanceof Date ? new Date(referenceDate) : new Date(`${referenceDate}T12:00:00`);
  if (Number.isNaN(reference.getTime())) throw new Error('Invalid reference date');
  let day; let month; let year;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(source)) {
    const parts = source.split('-').map(Number);
    [year, month, day] = parts;
  } else if (/^\d{1,2}$/.test(source)) {
    day = Number(source); month = reference.getMonth() + 1; year = reference.getFullYear();
  } else {
    const numeric = source.match(/^(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2}|\d{4}))?$/);
    const named = source.match(/^(\d{1,2})[.\-/]([A-Za-z]{3,9})[.\-/](\d{2}|\d{4})$/);
    if (numeric) {
      day = Number(numeric[1]); month = Number(numeric[2]);
      year = numeric[3] ? Number(numeric[3]) : reference.getFullYear();
    } else if (named) {
      const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
      month = months.indexOf(named[2].slice(0, 3).toLowerCase()) + 1;
      day = Number(named[1]); year = Number(named[3]);
    } else {
      throw new Error('Invalid date');
    }
  }
  if (year < 100) year += 2000;
  const result = new Date(year, month - 1, day, 12);
  if (result.getFullYear() !== year || result.getMonth() !== month - 1 || result.getDate() !== day) {
    throw new Error('Invalid date');
  }
  return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, '0')}-${String(result.getDate()).padStart(2, '0')}`;
}

function stepTallyDate(input, days, referenceDate = new Date()) {
  const value = parseTallyDate(input || referenceDate, referenceDate);
  const result = new Date(`${value}T12:00:00`);
  result.setDate(result.getDate() + Number(days || 0));
  return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, '0')}-${String(result.getDate()).padStart(2, '0')}`;
}

function parseTallyAmount(input) {
  const source = String(input ?? '').replace(/,/g, '').trim().toLowerCase();
  if (!source) return '0.00';
  const shorthand = source.match(/^([+-]?\d+(?:\.\d+)?)\s*(cr|c|l|k)$/);
  let value;
  if (shorthand) {
    const factor = { k: 1000, l: 100000, c: 10000000, cr: 10000000 }[shorthand[2]];
    value = Number(shorthand[1]) * factor;
  } else if (source.startsWith('=')) {
    value = safeCalculate(source.slice(1)).value;
  } else if (/^[+-]?\d+(?:\.\d+)?$/.test(source)) {
    value = Number(source);
  } else {
    throw new Error('Invalid amount');
  }
  if (!Number.isFinite(value)) throw new Error('Invalid amount');
  return value.toFixed(2);
}

function billingFraction(value) {
  const source=String(value??'0').trim();
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(source))throw new Error('Invalid billing value');
  const negative=source.startsWith('-'),clean=source.replace(/^[+-]/,'');
  const [whole,part='']=clean.split('.'),scale=10n**BigInt(part.length),numerator=BigInt((whole||'0')+(part||''));
  return {n:negative?-numerator:numerator,d:scale};
}
function billingAdd(left,right) {return {n:left.n*right.d+right.n*left.d,d:left.d*right.d};}
function billingNeg(value) {return {n:-value.n,d:value.d};}
function billingMul(left,right) {return {n:left.n*right.n,d:left.d*right.d};}
function billingDiv(left,right) {if(right.n===0n)throw new Error('Division by zero');return {n:left.n*right.d,d:left.d*right.n};}
function billingRound(value) {
  const negative=value.n<0n,number=negative?-value.n:value.n,scaled=number*100n,whole=scaled/value.d,remainder=scaled%value.d;
  const rounded=whole+(remainder*2n>=value.d?1n:0n),signed=negative?-rounded:rounded;
  const absolute=signed<0n?-signed:signed;
  return (signed<0n?'-':'')+(absolute/100n)+'.'+String(absolute%100n).padStart(2,'0');
}
function evaluateBillingFormula(expression,values={}) {
  const source=String(expression||''),tokens=[];let position=0;
  while(position<source.length){const match=/\s*(?:(\d+(?:\.\d*)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(.))/.exec(source.slice(position));if(!match)throw new Error('Invalid billing formula');position+=match[0].length;const [number,identifier,operator]=match.slice(1);if(number)tokens.push(['number',number]);else if(identifier)tokens.push(['field',identifier]);else if('+-*/%()'.includes(operator))tokens.push([operator,operator]);else throw new Error('Unsupported billing formula token: '+operator);}tokens.push(['end','']);let index=0;
  const current=()=>tokens[index],take=kind=>{const token=current();if(kind&&token[0]!==kind)throw new Error('Invalid billing formula');index+=1;return token;};
  const primary=()=>{const token=current();if(token[0]==='number'){take();return billingFraction(token[1]);}if(token[0]==='field'){take();if(!Object.prototype.hasOwnProperty.call(values,token[1]))throw new Error('Unknown billing formula field: '+token[1]);return billingFraction(values[token[1]]||'0');}if(token[0]==='('){take('(');const value=additive();take(')');return value;}throw new Error('Invalid billing formula');};
  const unary=()=>{if(current()[0]==='+'||current()[0]==='-'){const operator=take()[0],value=unary();return operator==='-'?billingNeg(value):value;}let value=primary();while(current()[0]==='%'){take('%');value=billingDiv(value,billingFraction('100'));}return value;};
  const multiplicative=()=>{let value=unary();while(current()[0]==='*'||current()[0]==='/'){const operator=take()[0],right=unary();value=operator==='*'?billingMul(value,right):billingDiv(value,right);}return value;};
  function additive(){let value=multiplicative();while(current()[0]==='+'||current()[0]==='-'){const operator=take()[0],right=multiplicative();value=operator==='+'?billingAdd(value,right):billingAdd(value,billingNeg(right));}return value;}
  const result=additive();if(current()[0]!=='end')throw new Error('Unexpected token in billing formula');return billingRound(result);
}

function normalizeAllocation(method, amount, rows = []) {
  const methods = ['New Ref', 'Agst Ref', 'Advance', 'On Account'];
  if (!methods.includes(method)) throw new Error('Unknown allocation method');
  const total = Number(parseTallyAmount(amount));
  if (!(total > 0)) throw new Error('Allocation amount must be positive');
  const allocations = rows.map(row => {
    const value = Number(parseTallyAmount(row.amount));
    if (!(value > 0)) throw new Error('Allocation amount must be positive');
    if (method === 'Agst Ref' && !String(row.bill_id || '').trim()) throw new Error('Bill reference is required');
    return { bill_id: String(row.bill_id || '').trim(), name: String(row.name || '').trim(), amount: value.toFixed(2) };
  });
  const allocated = allocations.reduce((sum, row) => sum + Number(row.amount), 0);
  if (allocated > total + 0.000001) throw new Error('Allocation exceeds voucher amount');
  if (method === 'Agst Ref' && Math.abs(allocated - total) > 0.000001) throw new Error('Allocation sum must equal voucher amount');
  return { method, amount: total.toFixed(2), allocations, residual: (total - allocated).toFixed(2) };
}

function normalizeInventoryAllocations(quantity, rows = []) {
  const total = Number(parseTallyAmount(quantity));
  if (!(total >= 0)) throw new Error('Inventory quantity must be nonnegative');
  const allocations = rows.map(row => {
    const value = Number(parseTallyAmount(row.quantity));
    if (!(value > 0)) throw new Error('Allocation quantity must be positive');
    return {
      godown: String(row.godown || 'Main Location').trim(),
      batch: String(row.batch || '').trim(),
      expiry: String(row.expiry || '').trim(),
      quantity: value.toFixed(2),
    };
  });
  const allocated = allocations.reduce((sum, row) => sum + Number(row.quantity), 0);
  if (Math.abs(allocated - total) > 0.000001) throw new Error('Inventory allocation sum must equal line quantity');
  return { quantity: total.toFixed(2), allocations };
}

function modeChoices(baseType) {
  return ['Sales', 'Purchase'].includes(baseType)
    ? ['invoice', 'accounting_invoice', 'voucher']
    : ['voucher'];
}

function preserveVoucherDraft(draft, targetMode) {
  return {
    ...JSON.parse(JSON.stringify(draft || {})),
    mode: targetMode,
    headers: JSON.parse(JSON.stringify(draft?.headers || {})),
    itemLines: JSON.parse(JSON.stringify(draft?.itemLines || [])),
    ledgerLines: JSON.parse(JSON.stringify(draft?.ledgerLines || [])),
    taxLines: JSON.parse(JSON.stringify(draft?.taxLines || [])),
    allocations: JSON.parse(JSON.stringify(draft?.allocations || [])),
  };
}

const voucherLogicApi = {
  shouldAdvanceSelect,
  paymentEntryOrder,
  shouldAppendInvoiceRow,
  adjustmentLedgers,
  balanceFromLedger,
  gstComponents,
  safeCalculate,
  parseTallyDate,
  stepTallyDate,
  parseTallyAmount,
  evaluateBillingFormula,
  normalizeAllocation,
  normalizeInventoryAllocations,
  modeChoices,
  preserveVoucherDraft,
};

if (typeof module !== 'undefined' && module.exports) module.exports = voucherLogicApi;
if (typeof window !== 'undefined') window.IndependentVoucherRules = voucherLogicApi;
