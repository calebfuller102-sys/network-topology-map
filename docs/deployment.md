# Deployment checklist

This document is a Phase 0 contract, not a claim that deployment has been
validated. Complete each item in the target environment before calling the
deployment milestone complete.

## Required facts

- Linux distribution and CPU architecture of the target host/LXC.
- Docker Engine and Docker Compose versions.
- Whether Docker is rootful or rootless and whether nested containers are
  supported by the LXC configuration.
- Whether NGINX Proxy Manager runs on the host or in another container.
- The NPM-to-gateway network path and authentication/forward-auth behavior.
- IPv4 routes from inside the API container to representative LAN targets.
- Whether the selected ICMP method works as a non-root process.

## Intended topology

NGINX Proxy Manager must be the only externally reachable entry point. It should
forward one protected origin to the `web` gateway. The gateway serves the SPA
and proxies `/api/` to `api` over the private Compose network. The API has no
published host port.

The default host binding is `127.0.0.1:${APP_PORT:-8080}` for an NPM instance
on the host. If NPM is containerized, use an explicitly named shared Docker
network or a documented override; do not assume that a container can reach the
host loopback interface.

## M5/M6 planning findings

These are code-inspection findings, not host validation results.

- `compose.yaml` currently marks the sole `app` network as `internal: true`.
  That isolation conflicts with any assumption that the API can reach LAN or
  cloud monitoring targets outside the Compose network. M6 must choose and
  document a least-access monitoring egress network while retaining no
  published API host port, then test routes from inside the actual API
  container. No Docker/LXC routing result has been claimed here.
- The snapshot route now begins an explicit SQLite read transaction before its
  related graph queries, so one HTTP snapshot does not mix rows around a
  concurrent write. M5 still needs a revision/cursor design spanning that
  snapshot and the SSE subscription, plus a mutation-during-handoff test; a
  consistent HTTP read alone cannot close the snapshot-to-subscribe race.
- HTTPS monitoring intentionally connects to the configured IPv4 URL. With
  TLS verification enabled, the certificate must contain that IPv4 address in
  its SAN; an HTTP `Host` header changes routing only and cannot supply TLS
  SNI. M6/M7 acceptance should use an IP-SAN certificate or an explicitly
  designed server-name field. Do not disable verification merely to work around
  this constraint; a successful certificate handshake remains unverified.

## Offline transfer

Build and test images on a connected machine, export the exact images with
`docker save`, transfer the archive and Compose bundle, then load with
`docker load` on the isolated host. Confirm the target architecture before
building or use an explicit `buildx --platform` target.
