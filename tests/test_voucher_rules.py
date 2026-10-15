import importlib.util
from pathlib import Path


BOOKS_PATH = Path(__file__).parents[1] / "books.py"
SPEC = importlib.util.spec_from_file_location("independent_books_books", BOOKS_PATH)
BOOKS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BOOKS)


def test_party_outstanding_reports_creditor_balance():
    company = {
        "state": "West Bengal",
        "ledgers": {
            "JT Steel Tube": {
                "name": "JT Steel Tube",
                "parent": "Sundry Creditors",
                "signed_closing": "-125000.00",
                "state": "West Bengal",
            }
        },
        "group_records": {},
        "bills_receivable": [],
        "bills_payable": [
            {"name": "INV-101", "ledger": "JT Steel Tube", "closing_balance": "125000.00"}
        ],
    }

    balance = BOOKS.party_outstanding(company, "JT Steel Tube")

    assert balance == {
        "ledger": "JT Steel Tube",
        "amount": "125000.00",
        "drcr": "Cr",
        "classification": "creditor",
        "bill_count": 1,
    }


def test_local_gst_splits_into_cgst_and_sgst():
    company = {
        "gstin": "19AAAAA0000A1Z5",
        "state": "West Bengal",
        "ledgers": {"Customer": {"state": "West Bengal", "parent": "Sundry Debtors"}},
        "group_records": {},
    }

    components = BOOKS.gst_components(company, "1000.00", "Customer", "18")

    assert components == [
        {"ledger": "CGST", "amount": "90.00", "drcr": "Cr", "rate": "9.00"},
        {"ledger": "SGST", "amount": "90.00", "drcr": "Cr", "rate": "9.00"},
    ]
