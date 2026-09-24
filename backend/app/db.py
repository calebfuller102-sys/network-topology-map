from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import Request
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker


class Database:
    def __init__(self, url: str):
        self.url = url
        self.process_started_at = datetime.now(UTC)
        connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
        self.engine = create_engine(url, connect_args=connect_args, future=True)
        if url.startswith("sqlite"):
            self._configure_sqlite()
        self.session_factory = sessionmaker(self.engine, autoflush=False, expire_on_commit=False)

    def _configure_sqlite(self) -> None:
        @event.listens_for(self.engine, "connect")
        def configure(dbapi_connection, _connection_record) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.close()

    def session(self) -> Session:
        return self.session_factory()

    def migrate(self) -> None:
        config_path = Path(__file__).resolve().parents[1] / "alembic.ini"
        config = Config(str(config_path))
        config.set_main_option("sqlalchemy.url", self.url.replace("%", "%%"))
        command.upgrade(config, "head")

    def dispose(self) -> None:
        self.engine.dispose()


def get_db(request: Request) -> Iterator[Session]:
    session = request.app.state.db.session()
    session.info["process_started_at"] = request.app.state.process_started_at
    try:
        yield session
    finally:
        session.close()
