from __future__ import annotations

from datetime import UTC, datetime


def utc_now() -> datetime:
    return datetime.now(UTC)


def utc_iso(value: datetime | None = None) -> str:
    current = value or utc_now()
    return current.astimezone(UTC).isoformat().replace("+00:00", "Z")
