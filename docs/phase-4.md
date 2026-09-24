# Phase 4 — monitor execution

## Delivered

- Added bounded asynchronous ICMP, TCP, and HTTP(S) runners. Timeouts cover the
  complete check, including slow HTTP responses; the scheduler only launches
  work while a concurrency slot is free, so it does not build an unbounded
  backlog of waiting tasks.
- Added one scheduler owned by the FastAPI lifespan. It schedules enabled
  monitors after startup/create/configuration changes and on each monitor's own
  interval. It avoids overlap per monitor, coalesces repeated manual requests,
  and cancels running work on configuration changes, disable, delete, or
  shutdown.
- Added `POST /api/v1/monitors/{monitor_id}/run` returning HTTP 202 immediately.
  Network I/O is performed without an open database session; result writes use
  a short separate transaction and verify the monitor still has the same
  enabled configuration.
- Persists only the latest result. Results predating process startup remain
  marked stale and aggregate to `unknown` until a new check completes. Disabled
  checks do not contribute to node status; disabling or changing a monitor
  clears its previous result.
- Added the configurable `MONITOR_CONCURRENCY` cap (1–64, default 8), API and
  scheduler tests, and bounded safe error messages.
- Fixed two M3 prerequisites found during implementation: commit SQLite's
  Alembic version-table write so repeated startup does not replay migrations,
  and return 422 rather than a server error for explicit null coordinates.

## Behavior and boundaries

- ICMP uses the system `ping` executable with fixed arguments, no shell, and a
  process deadline. The future Linux runtime image must include `iputils-ping`.
  No `NET_RAW` or privileged-container change is made before target-LXC
  verification.
- TCP refusal, timeout, and unreachable conditions produce concise error
  codes. HTTP uses GET, does not follow redirects, ignores ambient proxy
  settings, does not download response bodies, and considers 200–399 successful.
- HTTPS verifies certificates by default. The configured IPv4 URL is the TLS
  verification name; an HTTP Host header does not change TLS SNI.
- The scheduler is in-process: production must keep exactly one API process/
  worker until scheduler ownership moves to a separately designed service.
- No real monitored device, isolated LAN, Docker/LXC, NPM, offline transfer,
  SSE/browser update, or deployment test was performed. Those gates remain
  owned by M5–M7 as applicable.
- Monitor editing UI and live browser status updates are not added in this
  backend milestone; existing product milestone ownership remains in the
  roadmap.

## Exit gate

Local tests cover ICMP success to `127.0.0.1`, TCP success to a loopback
listener, a deterministic refused-connection error, HTTP 302/503 outcomes and
timeout against loopback fixtures, and TLS rejection against a plain local
socket. Scheduler tests cover intervals, concurrency, manual runs,
cancellation/rescheduling, result persistence, and stale status after
application restart. The sandbox filters closed loopback ports into timeouts,
so TCP refusal is exercised with a deterministic local test double rather than
claimed as a kernel-level refusal test. A successful HTTPS certificate
handshake was not run because no test certificate/key tooling is available
here. Target-specific ping permissions and routing remain unverified until the
actual Linux/LXC deployment is available.
