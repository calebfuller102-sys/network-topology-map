# Phase 0 record

## Completed

- Initialized a new Git repository because the supplied workspace had no
  existing repository or source tree.
- Copied the supplied master specification to `docs/product-spec.md`.
- Added project-level product constraints in `AGENTS.md`.
- Added the two-service Compose skeleton, environment example, ignore rules,
  README, and initial deployment/backup/API contracts.
- Confirmed the bundled runtime provides Node.js 24.19.0, pnpm 11.19.0, and
  Python 3.12.14.

## Phase 0 limitations

- No frontend or backend source existed at the end of Phase 0.
- Dependency selection and installation were intentionally deferred to the
  implementation package that owns each lockfile.
- No Docker image was built because the service Dockerfiles and applications do
  not exist yet.
- No LXC, NPM, routing, ICMP, offline-transfer, or restore test was possible
  from this workspace.

## Decisions required before host acceptance

- Target architecture and Docker/LXC mode.
- NPM placement and shared-network arrangement.
- ICMP method and capability requirement.
- Maximum expected topology/check count and scheduler concurrency.
- HTTPS TLS server-name behavior when checks target IPv4 addresses.
- SSE initial snapshot/reconnect revision semantics.

Phase 1 subsequently added the backend package and its pinned Python lockfile;
the limitations above describe the Phase 0 gate only.
