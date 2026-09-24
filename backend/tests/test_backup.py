from __future__ import annotations

import io
import sqlite3
from pathlib import Path

import pytest
from app.backup import backup_to_stream, restore_from_stream


def _create_database(path: Path) -> None:
    with sqlite3.connect(path) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT NOT NULL)")
        connection.executemany("INSERT INTO items (label) VALUES (?)", [("one",), ("two",)])


def test_online_backup_includes_wal_and_restores_intact_database(tmp_path: Path) -> None:
    source_path = tmp_path / "live.sqlite"
    _create_database(source_path)
    # Keep a connection open so the source remains in WAL mode during backup.
    live_connection = sqlite3.connect(source_path)
    try:
        live_connection.execute("INSERT INTO items (label) VALUES ('three')")
        live_connection.commit()

        payload = io.BytesIO()
        backup_to_stream(source_path, payload)

        restored_path = tmp_path / "restored.sqlite"
        restore_from_stream(io.BytesIO(payload.getvalue()), restored_path)
    finally:
        live_connection.close()

    with sqlite3.connect(restored_path) as restored:
        assert restored.execute("SELECT label FROM items ORDER BY id").fetchall() == [
            ("one",),
            ("two",),
            ("three",),
        ]
        assert restored.execute("PRAGMA integrity_check").fetchone() == ("ok",)


def test_invalid_restore_does_not_replace_existing_database(tmp_path: Path) -> None:
    database_path = tmp_path / "topology.sqlite"
    _create_database(database_path)
    original = database_path.read_bytes()

    with pytest.raises(sqlite3.DatabaseError):
        restore_from_stream(io.BytesIO(b"not a sqlite database"), database_path)

    assert database_path.read_bytes() == original
    assert not list(tmp_path.glob(".topology.sqlite.restore-*.tmp"))


def test_empty_sqlite_file_is_not_accepted_as_a_backup(tmp_path: Path) -> None:
    database_path = tmp_path / "topology.sqlite"
    _create_database(database_path)
    original = database_path.read_bytes()

    with pytest.raises(sqlite3.DatabaseError):
        restore_from_stream(io.BytesIO(b""), database_path)

    assert database_path.read_bytes() == original


def test_backup_refuses_missing_database_without_emitting_bytes(tmp_path: Path) -> None:
    output = io.BytesIO()
    with pytest.raises(FileNotFoundError):
        backup_to_stream(tmp_path / "missing.sqlite", output)
    assert output.getvalue() == b""
