from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Settings:
    database_url: str = "sqlite:///./topology.db"
    auto_migrate: bool = True
    monitor_concurrency: int = 8

    @classmethod
    def from_env(cls) -> Settings:
        database_url = os.getenv("DATABASE_URL", "sqlite:///./topology.db")
        auto_migrate = os.getenv("AUTO_MIGRATE", "true").lower() in {"1", "true", "yes"}
        try:
            monitor_concurrency = int(os.getenv("MONITOR_CONCURRENCY", "8"))
        except ValueError as exc:
            raise ValueError("MONITOR_CONCURRENCY must be an integer from 1 to 64") from exc
        if not 1 <= monitor_concurrency <= 64:
            raise ValueError("MONITOR_CONCURRENCY must be an integer from 1 to 64")
        return cls(
            database_url=database_url,
            auto_migrate=auto_migrate,
            monitor_concurrency=monitor_concurrency,
        )
