# Phase 6 record — packaging and operations

## Implemented in this working tree

- Added digest-pinned Python, Node, and NGINX images. The runtime services use
  non-root UIDs, read-only root filesystems, dropped capabilities, bounded
  writable `/tmp` mounts, and the persistent SQLite volume.
- Kept `web` and `api` on an internal app network; attached the web gateway to
  a dedicated bridge with IP masquerading disabled for its loopback-published
  port, and attached only the API to the separate monitor-egress bridge. The
  API has no published host port.
- Installed the SSE-aware NGINX config in the web image, with buffering off and
  a long stream timeout and dynamic Docker DNS for API container replacement.
  Added a separate external-NPM network overlay and an optional `NET_RAW`
  overlay that is not enabled by default.
- Added a SQLite online-backup CLI and operator scripts for checksummed backup,
  validated stopped-stack restore, target-platform image export/import, and
  deployment/rollback instructions.
- Added CI coverage for Compose model validation, overlay parsing, shell syntax,
  both image builds, and API recreation through the gateway. Updated the roadmap
  and M6 operating documentation.

## Local validation

- Backend Ruff and backend tests pass; the suite reports 32 passed, including
  online backup of a live WAL database, restore integrity, and invalid-backup
  preservation tests.
- Frontend asset verification, TypeScript check, and interaction tests pass.
  The production bundle succeeds using Vite's runner config loader.
- Docker Engine/Compose and WSL are unavailable on this workstation. Thus
  Compose parsing/builds, NGINX image startup, Bash operator scripts, target
  routes, NPM, ICMP permissions, cold restart, container restore, and WAN-off
  acceptance have not been exercised here. The GitHub workflow change has not
  been pushed, so its CI job has not run.
- The normal Vite config-bundling path is blocked by this Windows sandbox's
  access error traversing `../../../../..`; the production build with
  `--configLoader runner` succeeds. This is recorded rather than hidden.

## Exit gate

M6 implementation is present, but M6 is **not closed**. The owner environment
must supply the target CPU platform and Docker/LXC/NPM access/configuration,
then run the documented cold-start, routing, ICMP, NPM/SSE, restore, and
WAN-disconnected checks. Phase 7 has not started.
