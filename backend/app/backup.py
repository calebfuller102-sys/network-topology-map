"""Safe SQLite backup and restore operations for the operator scripts."""

from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path
from typing import BinaryIO

CHUNK_SIZE = 1024 * 1024


def _integrity_check(path: Path) -> None:
    with path.open("rb") as database_file:
        if database_file.read(16) != b"SQLite format 3\x00":
            raise sqlite3.DatabaseError("Backup is not a SQLite database")
    if path.stat().st_size < 100:
        raise sqlite3.DatabaseError("Backup database is truncated")
    connection = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)
    try:
        result = connection.execute("PRAGMA integrity_check").fetchone()
    finally:
        connection.close()
    if result != ("ok",):
        raise sqlite3.DatabaseError("SQLite integrity check failed")


def backup_to_stream(database_path: Path, output: BinaryIO) -> None:
    """Write a consistent SQLite online backup, including active WAL changes."""
    database_path = database_path.resolve()
    if not database_path.is_file():
        raise FileNotFoundError("The SQLite database does not exist")

    with tempfile.TemporaryDirectory(prefix="topology-backup-") as temporary_dir:
        backup_path = Path(temporary_dir) / "topology.sqlite"
        source = sqlite3.connect(database_path, timeout=10)
        destination = sqlite3.connect(backup_path)
        try:
            source.backup(destination, pages=256, sleep=0.1)
        finally:
            destination.close()
            source.close()
        _integrity_check(backup_path)
        with backup_path.open("rb") as backup_file:
            shutil.copyfileobj(backup_file, output, length=CHUNK_SIZE)


def restore_from_stream(input_stream: BinaryIO, database_path: Path) -> None:
    """Validate a backup then atomically replace the stopped app's database."""
    database_path = database_path.resolve()
    database_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{database_path.name}.restore-", suffix=".tmp", dir=database_path.parent
    )
    temporary_path = Path(temporary_name)
    try:
        os.chmod(temporary_path, 0o600)
        with os.fdopen(descriptor, "wb") as destination:
            shutil.copyfileobj(input_stream, destination, length=CHUNK_SIZE)
            destination.flush()
            os.fsync(destination.fileno())
        _integrity_check(temporary_path)

        # The caller must stop the API first. Remove old journal sidecars so they
        # cannot be associated with the restored database after the atomic swap.
        Path(f"{database_path}-wal").unlink(missing_ok=True)
        Path(f"{database_path}-shm").unlink(missing_ok=True)
        os.replace(temporary_path, database_path)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--stdout", action="store_true", help="write an online backup to stdout")
    action.add_argument(
        "--restore-stdin", action="store_true", help="validate and restore SQLite from stdin"
    )
    parser.add_argument(
        "--database",
        type=Path,
        default=Path(os.getenv("DATABASE_PATH", "/data/topology.db")),
        help="SQLite database path (default: DATABASE_PATH or /data/topology.db)",
    )
    arguments = parser.parse_args()

    try:
        if arguments.stdout:
            backup_to_stream(arguments.database, sys.stdout.buffer)
        else:
            restore_from_stream(sys.stdin.buffer, arguments.database)
    except (OSError, sqlite3.Error) as error:
        print(f"SQLite backup operation failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
