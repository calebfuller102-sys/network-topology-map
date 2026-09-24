# API contract status

The stable route families and response semantics are defined in section 6 of
[the product specification](product-spec.md). The implemented FastAPI routes
are reflected in the generated OpenAPI document at `/openapi.json`.

Node `icon_id` values are validated against the generated local manifest used
by the frontend: the device-oriented `mdi-*` IDs plus the allowlisted
`si-docker`, `si-kubernetes`, `si-proxmox`, `si-github`, and `si-cloudflare`
IDs. `frontend/scripts/generate-icons.mjs` writes the matching backend
allowlist, so the two sides cannot intentionally diverge. The API does not
accept arbitrary SVG identifiers or remote icon URLs.

Link routes support list/create under a map and patch/delete by link ID. Link
creation rejects self-links, cross-map endpoints, and duplicate endpoint/type
pairs.

Monitor routes support list/create under a node and patch/delete by monitor ID.
`POST /api/v1/monitors/{monitor_id}/run` returns `202` with a queued response;
it never waits for a target. Enabled monitors are checked immediately after
creation or configuration changes, then on their configured interval. A
single scheduler runs in the API lifespan; active checks are capped by
`MONITOR_CONCURRENCY` (default 8). Configuration changes cancel the prior run
where possible and clear its result until the new configuration has a fresh
check. Repeated manual requests coalesce to at most one additional run while a
check is active. Disabled and deleted monitors are removed from scheduling.

ICMP invokes the local system `ping` utility; TCP uses asynchronous socket
connect; HTTP(S) uses GET without following redirects or downloading the
response body. `200`–`399` are successful HTTP outcomes. HTTP requests ignore
proxy environment variables so checks stay direct to the configured IPv4
target. For HTTPS, certificate verification remains enabled by default;
because the URL uses the configured IPv4 address, TLS name verification is
against that IP address. An optional Host header changes HTTP routing only and
does not provide a separate TLS server name.

The M3 API contract and M4 monitor-run contract are implemented and tested.
Remaining event-stream contract work belongs to M5: define an SSE event
envelope and snapshot-resynchronization rule that cannot miss an update between
initial snapshot and subscription.
