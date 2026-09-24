# Network Topology Map

Self-hosted, offline-capable network topology mapping for one operator. The
product specification is in [docs/product-spec.md](docs/product-spec.md).

## Current status

This repository was initialized from an empty workspace. Phase 0 contains the
product specification, project constraints, deployment skeleton, environment
contract, and operator-facing checklists. Phase 1 contains the backend data/API
contract, Phase 2 contains the API-backed topology vertical slice, and Phase 3
contains link editing, the local icon manifest/picker, and accessibility
foundations. The remaining work is tracked in [docs/roadmap.md](docs/roadmap.md).

Phase 4 adds bounded ICMP/TCP/HTTP(S) check runners, a single lifespan-owned
scheduler, manual runs, result persistence, and derived status. Local tests and
backend lint pass; deployment-sensitive monitoring remains unverified. The
following facts are not available in this workspace and must be validated
before the deployment gate:

- target LXC operating system, CPU architecture, Docker mode, and permissions;
- NGINX Proxy Manager placement, network attachment, and authentication mode;
- routing from inside the API container to the intended IPv4 targets;
- whether ICMP works without `NET_RAW`, or requires that capability;
- the owner's reference screenshots and `message.txt` if they are not copied
  into the repository.

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

The initial Compose shape is in [compose.yaml](compose.yaml). Detailed
operator procedures will be completed before the deployment milestone.
