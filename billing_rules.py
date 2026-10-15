"""Deterministic, non-executable billing formulas for inventory vouchers."""
from copy import deepcopy
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import re


_TOKEN = re.compile(r'\s*(?:(\d+(?:\.\d*)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(.))')
_OPERATORS = {'+', '-', '*', '/', '%', '(', ')'}


def _tokenize(expression):
    source = str(expression or '')
    if not source.strip():
        raise ValueError('Billing formula is required')
    tokens = []
    position = 0
    while position < len(source):
        match = _TOKEN.match(source, position)
        if not match:
            raise ValueError('Invalid billing formula near position '+str(position))
        number, identifier, operator = match.groups()
        position = match.end()
        if number:
            tokens.append(('number', number))
        elif identifier:
            tokens.append(('identifier', identifier))
        elif operator in _OPERATORS:
            tokens.append((operator, operator))
        else:
            raise ValueError('Unsupported billing formula token: '+operator)
    tokens.append(('end', ''))
    return tokens


def parse_billing_formula(expression, allowed_fields):
    """Parse a restricted formula into a small immutable tuple AST."""
    tokens = _tokenize(expression)
    allowed = set(allowed_fields or ())
    index = 0

    def current():
        return tokens[index]

    def take(kind=None):
        nonlocal index
        token = current()
        if kind is not None and token[0] != kind:
            raise ValueError('Expected '+kind+' in billing formula')
        index += 1
        return token

    def primary():
        token = current()
        if token[0] == 'number':
            take()
            return ('number', token[1])
        if token[0] == 'identifier':
            take()
            if token[1] not in allowed:
                raise ValueError('Unknown billing formula field: '+token[1])
            return ('field', token[1])
        if token[0] == '(':
            take('(')
            value = additive()
            take(')')
            return value
        raise ValueError('Expected a number, field, or opening parenthesis in billing formula')

    def unary():
        if current()[0] in ('+', '-'):
            operator = take()[0]
            return ('unary', operator, unary())
        value = primary()
        while current()[0] == '%':
            take('%')
            value = ('percent', value)
        return value

    def multiplicative():
        value = unary()
        while current()[0] in ('*', '/'):
            operator = take()[0]
            value = ('binary', operator, value, unary())
        return value

    def additive():
        value = multiplicative()
        while current()[0] in ('+', '-'):
            operator = take()[0]
            value = ('binary', operator, value, multiplicative())
        return value

    tree = additive()
    if current()[0] != 'end':
        raise ValueError('Unexpected token in billing formula: '+current()[1])
    return tree


def _as_decimal(value, label):
    try:
        number = Decimal(str(value if value not in (None, '') else '0'))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError('Invalid billing value for '+label) from exc
    if not number.is_finite():
        raise ValueError('Billing value must be finite for '+label)
    return number


def _evaluate(tree, values):
    kind = tree[0]
    if kind == 'number':
        return _as_decimal(tree[1], 'literal')
    if kind == 'field':
        if tree[1] not in values:
            raise ValueError('Missing billing value for '+tree[1])
        return _as_decimal(values[tree[1]], tree[1])
    if kind == 'unary':
        value = _evaluate(tree[2], values)
        return value if tree[1] == '+' else -value
    if kind == 'percent':
        return _evaluate(tree[1], values) / Decimal('100')
    left = _evaluate(tree[2], values)
    right = _evaluate(tree[3], values)
    if tree[1] == '+': return left + right
    if tree[1] == '-': return left - right
    if tree[1] == '*': return left * right
    if right == 0: raise ValueError('Division by zero in billing formula')
    return left / right


def evaluate_billing_formula(expression, values, currency_quantum='0.01'):
    tree = parse_billing_formula(expression, set(values or {}))
    result = _evaluate(tree, values or {})
    if not result.is_finite():
        raise ValueError('Billing formula result must be finite')
    try:
        quantum = Decimal(str(currency_quantum))
        return result.quantize(quantum, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError) as exc:
        raise ValueError('Invalid currency precision') from exc


def _default_profile():
    return {
        'fields': [
            {'key': 'item', 'label': 'Item', 'kind': 'item', 'required': True},
            {'key': 'qty', 'label': 'Quantity', 'kind': 'number', 'required': True},
            {'key': 'alt_qty', 'label': 'Alt Quantity', 'kind': 'number', 'required': False},
            {'key': 'rate', 'label': 'Rate', 'kind': 'number', 'required': True},
            {'key': 'amount', 'label': 'Amount', 'kind': 'calculated', 'required': True},
        ],
        'formula': 'qty * rate',
        'quantity_basis': 'qty',
    }


def default_billing_profiles():
    return {name: deepcopy(_default_profile()) for name in (
        'Sales', 'Purchase', 'Credit Note', 'Debit Note',
    )}


def validate_billing_profiles(profiles):
    if not isinstance(profiles, dict):
        raise ValueError('Billing profiles must be an object')
    validated = {}
    for voucher_type, profile in profiles.items():
        if not isinstance(voucher_type, str) or not voucher_type.strip():
            raise ValueError('Billing profile voucher type is required')
        if not isinstance(profile, dict) or not isinstance(profile.get('fields'), list):
            raise ValueError('Billing profile fields are required for '+voucher_type)
        fields = []
        keys = set()
        numeric = set()
        for field in profile['fields']:
            if not isinstance(field, dict): raise ValueError('Billing field must be an object')
            key = str(field.get('key') or '').strip()
            label = str(field.get('label') or '').strip()
            kind = str(field.get('kind') or '').strip()
            if not key or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key):
                raise ValueError('Invalid billing field key: '+key)
            if key in keys: raise ValueError('Duplicate billing field: '+key)
            if kind not in ('item', 'number', 'calculated') or not label:
                raise ValueError('Invalid billing field definition: '+key)
            keys.add(key); fields.append({'key': key, 'label': label, 'kind': kind,
                'required': bool(field.get('required', False))})
            if kind in ('number', 'calculated'): numeric.add(key)
        if 'item' not in keys or 'amount' not in keys or 'amount' not in numeric:
            raise ValueError('Billing profile requires item and calculated amount fields')
        formula = str(profile.get('formula') or '').strip()
        if not formula: raise ValueError('Billing formula is required for '+voucher_type)
        parse_billing_formula(formula, numeric - {'amount'})
        basis = str(profile.get('quantity_basis') or 'qty')
        if basis not in numeric - {'amount'}:
            raise ValueError('Invalid billing quantity basis: '+basis)
        validated[voucher_type] = {'fields': fields, 'formula': formula, 'quantity_basis': basis}
    return validated


__all__ = [
    'default_billing_profiles', 'evaluate_billing_formula',
    'parse_billing_formula', 'validate_billing_profiles',
]
