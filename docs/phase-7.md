# Phase 7 record — monitor editor and diagnostics

## Scope and milestone allocation

The product specification's older M5 row mentions "inspector diagnostics," but
the current delivery roadmap assigns the monitor editor and per-check
diagnostics UI to Phase 7. This record follows the roadmap allocation requested
for the project; it does not alter the completed M5 SSE transport and recovery
work.

## Implemented

- Added a compact node-inspector monitor panel that creates, edits, enables,
  disables, and deletes ICMP, TCP, and HTTP(S) checks. It validates IPv4
  targets, required ports, HTTP scheme/path, interval, timeout, and a
  single-line optional Host header before saving, and displays API validation
  errors safely.
- Added per-check current configuration and latest-result diagnostics: local
  checked time, pass/fail outcome, HTTP status, latency when available, and a
  concise categorized failure reason. The data model deliberately remains
  latest-result-only; Phase 7 does not invent an outage-history feature.
- Added receipt-based **Check now** feedback. A `queued` receipt means only
  that the scheduler accepted work; `completed` means that exact execution
  persisted a result, and the displayed diagnostic says whether it passed or
  failed. Cancellation, restart, and other non-completion paths are shown as
  unavailable rather than as success.
- Kept inspector drafts stable while SSE snapshots replace a monitor's record.
  A draft resets only when the operator starts a new check, selects a different
  check/node, deliberately saves, or a selected monitor is deleted.
- Existing live-event handling refreshes the authoritative snapshot for status
  and topology updates. The monitor panel exposes the disconnected state and
  refreshes diagnostics after a terminal receipt or stream recovery, so stale
  result records are not retained after an API restart.

## Validation and remaining gates

The Phase 7 implementation passed backend scheduler/API tests plus frontend
type, interaction, local-asset, and production-build checks. An isolated
loopback browser fixture also created a TCP monitor for `127.0.0.1:18080`,
queued it with **Check now**, displayed the persisted completed result, and
showed the disconnected state followed by an authoritative recovery after a
local API restart. The narrow-width drawer was visually checked at 480 px.
These checks use only disposable local fixtures; they are not a substitute for
M6 deployment acceptance or real-device monitoring.

M6 remains **open**. Its actual Docker LXC, NGINX Proxy Manager authentication
and routing, API-container egress, least-privilege ICMP capability, cold
restart, backup/restore, and WAN-disconnected checks still require the owner's
target environment.
