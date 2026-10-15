"""Shared test resources; product data is never used by pytest fixtures."""
from pathlib import Path

import pytest


@pytest.fixture
def books_db(tmp_path):
    from books import Books

    db = Books(str(tmp_path / 'books.sqlite3'))
    try:
        yield db
    finally:
        db.connection.close()


@pytest.fixture
def application_root():
    return Path(__file__).parents[1]
