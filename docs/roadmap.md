# Delivery roadmap and deferred-work register

This file is the durable handoff checklist for work intentionally deferred from
earlier phases. An item is not considered forgotten merely because its code is
not present yet; it must have a phase owner and an exit gate here.

| Item | Owner phase | Current state | Exit gate |
| --- | --- | --- | --- |
| React/React Flow topology editor | Phase 2–3 | Phase 3 complete | Real API-backed topology create/edit/move/reload flow, links, and accessibility complete |
| Monitor runners and scheduler | Phase 4 | Implemented; local checks pass, successful HTTPS handshake and target-host ICMP unverified | ICMP/TCP/HTTP outcomes, bounded concurrency, cancellation, rescheduling, manual runs, and stale-result tests pass |
| Monitor editor and per-check diagnostics UI | Phase 7 | Deferred; backend API available | Owner can configure checks, trigger a manual run, and understand each check's latest result in the inspector |
| SSE event bus and recovery | Phase 5 | Implemented; bounded persisted handoff journal, SSE replay/resync, browser recovery refresh, and gateway configuration added | Revision-safe initial sync, reconnect snapshot recovery, and proxy keepalive test pass |
| Docker images and NGINX gateway | Phase 6 | Deferred; current internal-only Compose network has unverified monitor-target egress | Images build from pinned inputs, target reachability is verified, and `/api` remains private behind the gateway |
| NPM/LXC/ICMP acceptance | Phase 6–7 | Requires owner environment | Actual target LXC routing, permissions, NPM auth, and restart checks pass |
| Offline transfer and backup/restore | Phase 6–7 | Deferred | WAN-disconnected operation and restore smoke test pass |

## Phase gates

Do not mark a phase complete without updating this table and its phase record.
Every completion report must list deferred items that remain and the next phase
that owns them. Host-specific items must remain explicitly unverified until run
on the owner's target environment.
