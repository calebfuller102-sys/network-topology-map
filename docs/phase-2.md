# Phase 2 record

## Completed

- Added a pinned React 19/Vite/TypeScript frontend with `@xyflow/react`.
- Added a typed API client for maps, snapshots, node CRUD, node positions, and
  viewport persistence.
- Added a dark topology canvas with custom node cards, status semantics,
  handles, straight edges, controls, minimap, and an empty-map experience.
- Added local search across node name, type, IPv4, and display port with
  dimmed non-matches and an explicit no-results state.
- Added an API-backed node inspector for create, edit, delete, IPv4, display
  port, type, icon identifier, and explicit save operations.
- Persisted drag-stop positions through `PATCH /nodes/{node_id}/position`.
- Persisted the current viewport through `PATCH /maps/{map_id}`.
- Added responsive inspector behavior for narrow screens.
- Added [`docs/roadmap.md`](roadmap.md) as the durable register for deferred
  monitoring, SSE, deployment, and acceptance work.

## Validation

- TypeScript `tsc --noEmit` passed.
- Vite production build passed and generated the static bundle.
- The Phase 1 backend API tests continue to pass.
- The frontend dependency lockfile is present at `frontend/pnpm-lock.yaml` and
  is ready to be included in the next repository commit.
- No browser E2E runner is configured yet; the API contract is covered by the
  Phase 1 backend tests, while this phase's UI acceptance remains a manual
  browser check until the later QA/deployment gates.

## Deferred and tracked

- Link editing, icon manifest/picker, and deeper accessibility polish remain
  Phase 3 work.
- Monitor execution/scheduler remains Phase 4.
- SSE remains Phase 5.
- Docker/NPM/LXC/offline acceptance remains Phases 6–7.

The deferred-work register must be updated at every phase gate; these items are
not implied to be complete by the Phase 2 UI status legend.
