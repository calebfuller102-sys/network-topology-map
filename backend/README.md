# Backend package

FastAPI/SQLAlchemy/Alembic application for the topology map. M4 includes a
single lifespan-owned asynchronous monitor scheduler and bounded ICMP, TCP,
and HTTP(S) checks. SSE remains a later milestone.

## Local development

From the repository root, create a virtual environment and install the pinned
requirements from `requirements.lock`, then run:

```text
python -m alembic -c backend/alembic.ini upgrade head
uvicorn app.main:app --app-dir backend --reload
```

The application also runs the same Alembic upgrade at startup so a fresh local
SQLite database is initialized consistently. Production remains single-worker
while the scheduler is active.

`MONITOR_CONCURRENCY` sets the maximum active checks (1–64, default 8). ICMP
uses the system `ping` executable; the eventual Linux runtime image must include
`iputils-ping`. Do not add `NET_RAW` or privileged mode unless the target LXC
test proves the selected ping implementation requires the capability.
