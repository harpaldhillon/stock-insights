from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

import database
import pytest


def test_base_metadata_creates_expected_tables(db_engine):
    inspector = inspect(db_engine)
    assert {"prices", "analysis"}.issubset(set(inspector.get_table_names()))


def test_price_table_columns(db_engine):
    inspector = inspect(db_engine)
    cols = {c["name"] for c in inspector.get_columns("prices")}
    assert {"id", "ticker", "date", "open", "high", "low", "close", "volume"}.issubset(cols)


def test_price_table_has_composite_ticker_date_index(db_engine):
    # Backs the "latest price per ticker" bulk query in get_summary — without
    # it, that query degrades to a full table scan.
    inspector = inspect(db_engine)
    index_columns = [tuple(idx["column_names"]) for idx in inspector.get_indexes("prices")]
    assert ("ticker", "date") in index_columns


def test_init_db_adds_composite_index_to_pre_existing_table(monkeypatch):
    # Simulates a database file created before this index existed (like the
    # already-deployed backend/ftse_analyser.db) — create_all() alone won't
    # retrofit a missing index onto a table that already exists, so init_db()
    # must add it defensively.
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    with engine.connect() as conn:
        conn.execute(text(
            "CREATE TABLE prices (id INTEGER PRIMARY KEY, ticker TEXT, date DATE, "
            "open FLOAT, high FLOAT, low FLOAT, close FLOAT, volume FLOAT)"
        ))
        conn.commit()

    monkeypatch.setattr(database, "engine", engine)
    database.init_db()

    inspector = inspect(engine)
    index_columns = [tuple(idx["column_names"]) for idx in inspector.get_indexes("prices")]
    assert ("ticker", "date") in index_columns
    engine.dispose()


def test_analysis_table_columns(db_engine):
    inspector = inspect(db_engine)
    cols = {c["name"] for c in inspector.get_columns("analysis")}
    assert {"ticker", "signal", "conviction", "score", "notes", "run_date"}.issubset(cols)


def test_init_db_creates_tables(monkeypatch, db_engine):
    monkeypatch.setattr(database, "engine", db_engine)
    database.init_db()
    inspector = inspect(db_engine)
    assert {"prices", "analysis"}.issubset(set(inspector.get_table_names()))


def test_get_db_yields_a_session_and_closes_it(monkeypatch, db_engine):
    TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=db_engine)
    monkeypatch.setattr(database, "SessionLocal", TestSessionLocal)

    gen = database.get_db()
    session = next(gen)
    assert session is not None
    with pytest.raises(StopIteration):
        next(gen)
