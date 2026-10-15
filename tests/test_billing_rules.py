from decimal import Decimal

import pytest

from billing_rules import evaluate_billing_formula, parse_billing_formula
from interchange import apply_import, export_xml
from books import Books


def test_billing_formula_uses_decimal_values_and_currency_rounding():
    result = evaluate_billing_formula(
        'qty * rate', {'qty': Decimal('2.5'), 'rate': Decimal('3.40')}
    )

    assert result == Decimal('8.50')


def test_billing_formula_supports_alternate_quantity_and_percentage_suffix():
    result = evaluate_billing_formula(
        'qty * rate * (1 - discount%)',
        {'qty': Decimal('2'), 'rate': Decimal('100'), 'discount': Decimal('10')},
    )

    assert result == Decimal('180.00')


@pytest.mark.parametrize('expression', [
    'qty ** rate', 'qty + unknown', 'qty +', 'round(qty)', 'qty; rate'
])
def test_billing_formula_rejects_unsafe_or_invalid_expressions(expression):
    with pytest.raises(ValueError):
        parse_billing_formula(expression, {'qty', 'rate'})


def test_billing_formula_rejects_division_by_zero_at_evaluation():
    with pytest.raises(ValueError, match='Division by zero'):
        evaluate_billing_formula('qty / 0', {'qty': Decimal('1')})


def test_company_billing_profiles_persist_and_validate_client_amount(books_db):
    books_db.create_or_alter_company({
        'name': 'Billing Test', 'starting_from': '20260401', 'ending_at': '20270331'
    })
    profiles = books_db.billing_profiles('Billing Test')
    profiles['Sales']['formula'] = 'alt_qty * rate'
    books_db.save_billing_profiles('Billing Test', profiles)

    assert books_db.billing_profiles('Billing Test')['Sales']['formula'] == 'alt_qty * rate'
    rows = books_db.validate_billing_rows(
        'Billing Test', 'Sales',
        [{'item': 'Steel', 'qty': '2', 'alt_qty': '3', 'rate': '10', 'amount': '30.00'}],
        client_amounts=['30.00'],
    )
    assert rows[0]['amount'] == '30.00'

    with pytest.raises(ValueError, match='amount mismatch'):
        books_db.validate_billing_rows(
            'Billing Test', 'Sales',
            [{'item': 'Steel', 'qty': '2', 'alt_qty': '3', 'rate': '10', 'amount': '30.00'}],
            client_amounts=['29.99'],
        )


def test_post_voucher_rejects_client_amount_before_inventory_posting(books_db):
    books_db.create_or_alter_company({
        'name': 'Posting Test', 'starting_from': '20260401', 'ending_at': '20270331'
    })
    for name, parent in [('Customer', 'Sundry Debtors'), ('Sales', 'Sales Accounts')]:
        books_db.save_master('Posting Test', 'ledger', {
            'name': name, 'parent': parent, 'opening_balance': '0', 'drcr': 'Dr'
        })
    books_db.save_master('Posting Test', 'unit', {'name': 'pcs'})
    books_db.save_master('Posting Test', 'stock_item', {
        'name': 'Steel', 'base_units': 'pcs', 'opening_qty': '10', 'opening_rate': '1'
    })
    voucher = {
        'VOUCHERTYPENAME': 'Sales', 'VOUCHERNUMBER': '1', 'DATE': '20260401',
        'PARTYLEDGERNAME': 'Customer',
        'BILLING_ROWS': [{'item': 'Steel', 'qty': '2', 'alt_qty': '3', 'rate': '10', 'amount': '30.00'}],
        'BILLING_CLIENT_AMOUNTS': ['29.99'],
        'ALLLEDGERENTRIES.LIST': [
            {'LEDGERNAME': 'Customer', 'ISDEEMEDPOSITIVE': 'No', 'AMOUNT': '-30.00'},
            {'LEDGERNAME': 'Sales', 'ISDEEMEDPOSITIVE': 'Yes', 'AMOUNT': '30.00'},
        ],
        'ALLINVENTORYENTRIES.LIST': [{
            'STOCKITEMNAME': 'Steel', 'ACTUALQTY': '2 pcs', 'BILLEDQTY': '2 pcs',
            'RATE': '10/pcs', 'AMOUNT': '30.00', 'ISDEEMEDPOSITIVE': 'No',
        }],
    }

    with pytest.raises(ValueError, match='amount mismatch'):
        books_db.post_voucher('Posting Test', voucher)
    assert books_db.get_company('Posting Test')['vouchers'] == []


def test_billing_profiles_survive_xml_round_trip(books_db, tmp_path):
    books_db.create_or_alter_company({
        'name': 'Round Trip', 'starting_from': '20260401', 'ending_at': '20270331'
    })
    profiles = books_db.billing_profiles('Round Trip')
    profiles['Sales']['formula'] = 'alt_qty * rate'
    books_db.save_billing_profiles('Round Trip', profiles)
    restored = Books(str(tmp_path / 'restored.sqlite3'))

    apply_import(restored, {'xml': export_xml(books_db.get_company('Round Trip'))})

    assert restored.billing_profiles('Round Trip')['Sales']['formula'] == 'alt_qty * rate'
