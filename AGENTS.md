# Network Topology project instructions

## Source of truth

`docs/product-spec.md` is the product specification. It defines the V1 scope,
acceptance criteria, data model, API contract, deployment constraints, and
milestones. If the implementation and specification disagree, stop and record
the discrepancy before silently changing behavior.

## V1 boundaries

- This is a manually edited topology map with live availability indicators.
- V1 includes nodes, local/virtual links, ICMP/TCP/HTTP(S) checks, SQLite
  persistence, SSE updates, local icon/font assets, and offline Docker Compose
  deployment behind NGINX Proxy Manager.
- V1 excludes discovery, telemetry, traffic metrics, alerting, outage history,
  user accounts/RBAC, third-party integrations, and native mobile applications.
- Never add runtime WAN requests, arbitrary SVG execution, Docker socket access,
  or privileged containers.

## Engineering rules

- Inspect the repository and current runtime before changing architecture.
- Do not invent host, LXC, NPM, routing, credential, screenshot, or network
  facts. Mark unavailable acceptance gates as unverified.
- Keep the API on one worker while SQLite and the monitor scheduler are used.
- Treat monitor results as bounded, cancellable network work; never hold a
  database transaction while a check is running.
- Validate IPv4 addresses, ports, intervals, cross-map links, icon IDs, and
  finite coordinates at the API boundary.
- Keep mutations small and test meaningful risk: graph integrity, scheduler
  races, aggregation, network outcomes, persistence, and SSE recovery.

## Phase discipline

Work one milestone at a time. Before advancing, run the relevant checks, review
the changed files, state what was verified, and list any host-specific gates
that still require the owner's environment.
