# Phase 1 record

## Completed

- Added pinned Python package metadata and a reproducible `requirements.lock`.
- Added SQLAlchemy models and an Alembic `0001_initial` migration for maps,
  nodes, links, monitors, and latest monitor results.
- Enabled SQLite foreign keys and WAL mode; cascade deletion is covered by the
  API tests.
- Added FastAPI application startup migration and automatic creation of the
  single `Home` map when the database is empty.
- Added typed validation for IPv4 addresses, ports, coordinates, map viewport,
  link integrity, monitor kind-specific fields, intervals, timeouts, and
  bounded host/path inputs.
- Added consistent JSON error envelopes for validation, not-found, conflict,
  and application-level API errors.
- Added CRUD routes for maps, nodes, links, and monitors plus a consistent
  snapshot route with derived node status and stale-result metadata.

## Validation

- Python bytecode compilation passed for the app and Alembic modules.
- Ruff check passed for backend app and tests.
- Four focused API tests passed: snapshot/home initialization, graph and
  position validation, monitor semantics/status aggregation, and cascade
  deletion.
- OpenAPI route smoke check registered 15 routes, including health, map,
  snapshot, node, link, and monitor route families.
- Git whitespace validation passed.

## Deferred to later phases

- Frontend implementation and typed browser client.
- Monitor execution, scheduler, manual check enqueue, and network-specific
  outcome tests.
- SSE event bus/reconnect behavior.
- Docker image builds, NPM routing, LXC permissions, and offline acceptance.
