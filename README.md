# Network Topology Map

Self-hosted, offline-capable network topology mapping for one operator. The
product specification is in [docs/product-spec.md](docs/product-spec.md).

## Current status

M0–M5 and Phase 7's local monitor editor/diagnostics work are implemented. M6
packaging groundwork is implemented: private GHCR image definitions,
digest-pinned Dockerfiles, a private API gateway layout, optional NPM and ICMP
overlays, checksummed offline image transfer, and SQLite backup/restore
procedures. The remaining project state and
phase gates are tracked in [docs/roadmap.md](docs/roadmap.md). M6 remains open
until its actual target-host checks pass.

This checkout does not have Docker Engine/Compose available, so container image
builds and target deployment checks have not been performed here. The owner's
environment must still confirm:

- target LXC operating system, CPU architecture, Docker mode, and permissions;
- direct loopback browser access; NPM is optional until remote access is needed;
- routing from inside the API container to intended IPv4 targets;
- whether ICMP works without `NET_RAW`, or requires that capability;
- cold restart, restore smoke test, and WAN-disconnected operation.

## Backend local commands

The backend checks can be run with the pinned virtual environment:

```text
backend\\.venv\\Scripts\\python.exe -m ruff check backend\\app backend\\tests
$env:PYTHONPATH='backend'; backend\\.venv\\Scripts\\python.exe -m pytest backend\\tests
```

## Frontend local commands

Run from `frontend` with the pinned lockfile:

```text
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

## Deployment shape

The intended runtime is two containers:

- `web`: static SPA and NGINX reverse proxy;
- `api`: FastAPI, SQLite, migrations, SSE, and the single monitor scheduler.

The deployable Compose shape is in [compose.yaml](compose.yaml). See
[docs/deployment.md](docs/deployment.md) and
[docs/backup-restore.md](docs/backup-restore.md) for GHCR pulls, local builds,
NPM, offline transfer, and backup/restore procedures.
