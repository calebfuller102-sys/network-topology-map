# Network Topology Map — master product specification and Codex prompt

**Status:** implementation-ready V1 specification  
**Date:** 23 September 2026  
**Owner:** single operator; self-hosted LAN deployment

## 1. Product definition

Build a browser-based, manually edited network topology map with live availability indicators. The map is the product: no dashboard, inventory suite, autodiscovery, telemetry platform, or external intelligence feed. It runs on a Docker-capable Linux LXC host behind the owner's existing NGINX Proxy Manager (NPM). Once built and transferred, it functions without Internet access.

**Reference roles:** `KKAuvik.png` supplies map behavior and spatial overview (ignore its left navigation and bottom dashboard); `d0au0jbxbsuf1.png` supplies the dark visual language, compact technical labels, restrained color, thin lines, and device glyphs. The latter is a design reference, not a demand to reproduce its fixed diagram or every port and metric. The original request in `IMG_5043.jpeg` describes a self-hosted network map with basic online verification. `message.txt` supplies the detailed requirements.

### V1 outcomes

1. Add, edit, move, search, and remove arbitrary nodes representing physical devices, VMs, containers, Kubernetes objects, services, or cloud services.
2. Draw, edit, and remove links between nodes. `local` is solid; `virtual` (including Internet links) is dashed. Links express user-entered topology, not automatically verified network routes.
3. Store one or more ICMP, TCP, or HTTP(S) monitors per node; the editing UI makes one primary monitor easy, with an **Add check** control for more. Nodes without checks are valid.
4. Show live, understandable health states without a page reload. Save node positions and the current viewport across reloads.
5. Run from locally built images and bundled assets, with persistent data and backup/restore instructions. Core map behavior remains usable without WAN access; non-bundled Material Design icons may be retrieved from the approved public icon service when connected.

### Explicitly outside V1

Discovery (SNMP, LLDP/CDP, Docker socket, Kubernetes API), bandwidth/traffic metrics, port-level diagramming, automatic layout, outage history/percentages, alert destinations, user accounts/RBAC, third-party integrations, mobile native apps, arbitrary SVG uploads, and automatic geographic mapping. A single map is exposed initially; the schema supports additional maps later. Expandable server/service groups are a later feature; keep node IDs and coordinates independent so grouping can be added without data loss.

## 2. Decisions and assumptions to validate at acceptance

| Topic | V1 decision |
| --- | --- |
| Network reach | Monitored target is an IPv4 address reachable **from inside the API container**; the IPv4-only requirement does not prove every site/VLAN is reachable. Test actual host and container routing. |
| Offline | No WAN is needed for core map behavior. Download dependencies and build images on a connected machine; transfer images and Compose bundle to an isolated host. Typed non-bundled `mdi-*` icons attempt a best-effort lookup from Iconify when connected and otherwise show the bundled fallback. External/cloud targets can only be checked when the host has a route to them. |
| Auth | The first client handoff may run loopback-only on its Docker LXC without NPM, so it is reachable only from a browser on that host. For later remote access, the owner supplies authentication at NPM; the application binds its gateway to loopback by default and documents how to prevent bypassing NPM. NPM protection must cover both UI and `/api`, including SSE. |
| Checks | Each monitor has its own interval in seconds, default 30, allowed 5–3600. One process owns the scheduler; do not run multiple API workers/replicas with SQLite. |
| HTTP | GET `/` by default; statuses 200–399 pass; redirects are not followed by default; TLS certificates are verified by default. Expose path, scheme, and optional host header; keep TLS bypass an explicit per-check advanced setting with a warning. |
| Status | `unknown` until first check or on missing/disabled monitors; `online` if all enabled checks pass; `degraded` if some pass and some fail; `offline` if all fail. A timeout is a failed check. UI also shows last checked, latency, and per-check error. |
| Failure noise | Reflect check results on completion in V1. Do not imply alerting or outage confirmation. An optional two-failure debounce is a later setting. |
| Server time | Store UTC timestamps and render them in the browser's locale. Persist latest result per monitor; no history in V1. |
| Address display | Name bold on line 1; muted address on line 2 (`IPv4:port` if port supplied, otherwise IPv4). A node can lack an address and show `No address`. |
| Connection semantics | Neither line type controls health or propagates failure color. Monitor status belongs to nodes only; a selected link is accented independently. |

The address `10.0.0.270:25565` in the sample is invalid IPv4. Input validation must reject octets above 255; use `10.0.0.27:25565` in demos.

## 3. User flows and acceptance criteria

**Map:** Open the app and see saved nodes and links on an expansive near-black canvas. Pan, zoom, fit to view, and search by name/address; search focuses/highlights a result. A compact toolbar offers **Add node**, **Fit**, and an unobtrusive status legend. An empty map explains how to add the first node. Keyboard Delete removes the selected item after confirmation where data loss is significant. Keyboard navigation and visible focus are required for controls and inspector forms.

**Node:** Add a node with name, type, icon identifier, optional HTTP(S) hyperlink, optional IPv4, optional display port, and coordinates. Selecting it opens a right inspector; with no selection the map uses the full workspace. A node icon with a saved hyperlink opens it in a new tab. Save edits explicitly; drag movement is debounced and persisted on drag stop. Deleting a node also removes its connected links and checks after confirmation. Invalid icon IDs display a safe fallback and a helpful validation message. Never execute pasted markup as SVG/HTML.

**Links:** Drag from visible connection handles or use an inspector action to connect two nodes. Assign `local` or `virtual`; change type in link inspector. Reject self-links and duplicate unordered pairs of the same type in the same map; permit a local and a virtual link between the same two nodes if expressly created. No arrowheads in V1.

**Checks:** Add ICMP with target IPv4; TCP with IPv4 and port 1–65535; HTTP(S) with IPv4, port, path, and scheme. A node IPv4 can prefill the target, but a monitor owns its own target values so it remains explicit. Each enabled check runs on its configured cadence, has a bounded timeout (default 3 seconds), and displays latest result or concise error. A manual **Check now** action runs a check without changing its schedule. Deleting/disable removes its result from aggregation immediately. Monitor changes reschedule cleanly.

**Live:** A polling result updates the selected inspector and map through SSE. On connection loss, show `Live updates disconnected`; reconnect automatically and fetch a fresh snapshot so missed events do not leave stale colors. Initial HTTP snapshot precedes SSE subscription; after reconnect, refetch the snapshot. A paused browser and restarted backend must recover without a reload.

**Persistence:** Restart containers, reload the page, and confirm all nodes, links, checks, positions, and viewport survive. Monitoring resumes; former check results are visibly marked stale until fresh checks complete. Deleting a map is outside V1.

**Offline demonstration:** With WAN disconnected, load and edit UI, render bundled icons/fonts, create links, save/reload topology, check reachable LAN targets, and receive status changes. A non-bundled `mdi-*` icon uses the neutral bundled fallback when Iconify is unavailable. An unreachable cloud target reports offline with a useful error and does not stall other checks.

## 4. Architecture

**Frontend:** React + TypeScript + Vite, `@xyflow/react` for pan/zoom, custom nodes/edges and handles, and locally bundled CSS/fonts/icons. Avoid Next.js server rendering: this is a small SPA and needs no Node runtime in deployment. Use typed API client and small focused state management; do not persist whole graph blobs in localStorage.

**Backend:** FastAPI + Pydantic + SQLAlchemy + Alembic + SQLite. A single Uvicorn worker handles REST, SSE, and an asyncio monitoring scheduler started/stopped via application lifespan. Bounded concurrency and per-check timeouts protect it from slow targets. SQLite is stored on a local persistent volume with foreign keys enabled and WAL mode; document that the DB must not live on an unreliable network filesystem. Keep write transactions short; do not hold a DB transaction during network checks. The scheduler enqueues new work on monitor edits and avoids overlapping checks of the same monitor.

**Gateway:** A small NGINX image serves the built SPA and proxies `/api/` to the API container on a private Compose network. The API also joins a separate egress network for configured monitor targets; it has no published host port. The first client handoff uses the loopback-only gateway directly from the Docker LXC, without NPM. NPM may later front only the gateway for remote/authenticated access. Disable response buffering and set an appropriate read timeout for the map SSE route. The owner can route NPM to the loopback gateway port if NPM shares the host, or attach only the gateway to an explicitly named Docker network if NPM runs in a container. Document both alternatives without assuming a particular NPM setup.

**Icon resolution:** Support `mdi-<slug>` and `si-<slug>` strings. At **build time**, generate a normalized, allowlisted icon manifest and local assets from pinned `@mdi/js` and `simple-icons` packages. At runtime, allow any normalized `mdi-<slug>` identifier and retrieve it only as an image from `https://api.iconify.design/mdi/<slug>.svg`; the browser policy must permit only that host for remote images. Use a fixed icon-service color parameter so external monotone SVGs remain visible on the dark canvas. Keep `si-*` identifiers allowlisted locally. Ship a neutral network fallback whenever a remote MDI icon cannot load. Never render remote or user-provided SVG markup in the document. Check package licenses/brand guidelines in the release README. Include a searchable picker plus direct identifier entry; avoid bundling an enormous icon module into the initial JS chunk if a static asset manifest works better.

**Dependencies:** Pin exact release versions with committed lockfiles and Docker base image digests when implementing. Recheck framework and package APIs at implementation time rather than copying a version number from this document.

## 5. Data model

Use UUID strings as public IDs; timestamps are UTC ISO 8601. Schema migrations are applied once at container start with a documented backup step for upgrades. SQL below is conceptual SQLite DDL; Alembic models/migrations are authoritative.

```sql
CREATE TABLE maps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  viewport_x REAL NOT NULL DEFAULT 0,
  viewport_y REAL NOT NULL DEFAULT 0,
  viewport_zoom REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN
    ('device','vm','container','kubernetes','service','cloud','other')),
  icon_id TEXT NOT NULL DEFAULT 'mdi-server',
  hyperlink TEXT,                    -- absolute HTTP(S), no credentials
  ipv4 TEXT,                         -- validate with IPv4Address in API
  display_port INTEGER CHECK(display_port BETWEEN 1 AND 65535),
  x REAL NOT NULL,
  y REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE links (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  source_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('local','virtual')),
  created_at TEXT NOT NULL,
  CHECK(source_node_id <> target_node_id)
);
CREATE TABLE monitors (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('icmp','tcp','http')),
  enabled INTEGER NOT NULL DEFAULT 1,
  target_ipv4 TEXT NOT NULL,
  port INTEGER CHECK(port BETWEEN 1 AND 65535),
  scheme TEXT CHECK(scheme IN ('http','https')),
  path TEXT,
  host_header TEXT,
  verify_tls INTEGER NOT NULL DEFAULT 1,
  interval_seconds INTEGER NOT NULL DEFAULT 30
    CHECK(interval_seconds BETWEEN 5 AND 3600),
  timeout_seconds INTEGER NOT NULL DEFAULT 3
    CHECK(timeout_seconds BETWEEN 1 AND 30),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE monitor_results (
  monitor_id TEXT PRIMARY KEY REFERENCES monitors(id) ON DELETE CASCADE,
  success INTEGER NOT NULL,
  checked_at TEXT NOT NULL,
  latency_ms REAL,
  http_status INTEGER,
  error_code TEXT,
  error_message TEXT
);
CREATE INDEX ix_nodes_map ON nodes(map_id);
CREATE INDEX ix_links_map ON links(map_id);
CREATE INDEX ix_monitors_node ON monitors(node_id);
```

Add a unique index on `(map_id, min(source_node_id,target_node_id), max(source_node_id,target_node_id), kind)` or canonicalize endpoint ID ordering at insert and use a simple unique index. Check at the API layer that both endpoint nodes belong to `map_id`. ICMP requires no port/scheme/path; TCP requires port; HTTP requires scheme/port/path, path starts with `/`, and Host header is optional. Reject extra contradictory fields instead of silently ignoring them. On startup create a single `Home` map if no map exists.

**Status is derived, not a node column.** Join enabled monitors to their latest results and derive status. If a result predates process restart, show it as `stale` in response metadata until a fresh check completes. Use `unknown` while enabled monitors lack fresh results; with a mixture of fresh and pending checks, represent the aggregate as `unknown` and show individual results rather than claiming all checks pass. Result messages are bounded and safe to display.

## 6. REST and event contract

Prefix every route `/api/v1`. All mutations validate JSON with consistent 400/404/409/422 responses. Return an entity and updated aggregate where useful. Use generated OpenAPI as the detailed contract; keep the following routes stable.

| Method and path | Purpose |
| --- | --- |
| `GET /healthz` | Process readiness (inside `/api/v1`); no target status implied. |
| `GET /maps` | List maps (one visible in V1). |
| `GET /maps/{map_id}` | Map metadata and saved viewport. |
| `PATCH /maps/{map_id}` | Save name/viewport, debounced for viewport. |
| `GET /maps/{map_id}/snapshot` | Nodes, links, monitors, latest check results, derived statuses in one consistent initial response. |
| `GET /maps/{map_id}/nodes` / `POST /maps/{map_id}/nodes` | List/create nodes. |
| `GET /nodes/{node_id}` / `PATCH /nodes/{node_id}` / `DELETE /nodes/{node_id}` | Node details/edit/delete. |
| `PATCH /nodes/{node_id}/position` | Save drag-stop position; avoid rebuilding all data. |
| `GET /maps/{map_id}/links` / `POST /maps/{map_id}/links` | List/create links. |
| `PATCH /links/{link_id}` / `DELETE /links/{link_id}` | Edit type/remove link. |
| `GET /nodes/{node_id}/monitors` / `POST /nodes/{node_id}/monitors` | List/create checks. |
| `PATCH /monitors/{monitor_id}` / `DELETE /monitors/{monitor_id}` | Edit/disable/delete check. |
| `POST /monitors/{monitor_id}/run` | Enqueue immediate check; return 202, do not block on target. |
| `GET /maps/{map_id}/events` | SSE stream of changed node status/result and topology edits. |

Sample status event, followed by an `EventSource` reconnect refresh:

```text
event: status.updated
data: {"map_id":"...","node_id":"...","status":"offline","checked_at":"2026-09-23T18:00:00Z","monitors":[{"id":"...","success":false,"error_code":"timeout"}]}

```

Send SSE keepalive comments periodically. Events are notifications, not durable history; clients refetch snapshot after reconnect. The API is for the app and is not an agent heartbeat API in V1. Monitor status must not rely on a browser tab being open.

## 7. Component hierarchy and visual system

```text
App
└─ MapPage
   ├─ TopBar (map name, search, add node, live indicator)
   ├─ TopologyCanvas (@xyflow/react)
   │  ├─ TopologyNode (icon, name, address, status marker, handles)
   │  ├─ TopologyEdge (solid or dashed; selection affordance)
   │  ├─ CanvasControls (fit, zoom)
   │  └─ EmptyMapHint
   ├─ Inspector
   │  ├─ NodeForm + MonitorList + MonitorForm
   │  └─ LinkForm
   └─ StatusLegend + ToastRegion + ConfirmDialog
```

**Tokens (starting values, adjust after visual QA):** canvas `#111617`; surface `#171D1F`; raised `#20282A`; border `#344044`; primary text `#E4EAEB`; secondary `#91A0A3`; cyan accent `#79CDE3`; online `#55C7AA`; degraded `#E6BD65`; offline `#F36F6F`; unknown `#77888B`. These are design proposals, not sampled exact colors. Use accessible contrast for small labels and never communicate state by color alone (tooltip/label and semantic status text).

Compact rectangular cards around 190–240 px wide with 8–10 px corners, 1 px borders, little or no shadow, 12–13 px typography, a locally bundled mono face for addresses, a clear sans for names, and a small glyph. Bold name on line one; muted IPv4 and port on line two. Use thin, mostly neutral edges; solid local vs dashed virtual remains distinguishable even without color. Status accent is a small dot or narrow border, not a flood fill. Inspector is a fixed right panel around 320–380 px wide on desktop; on narrow screens use a drawer. Canvas occupies most of the viewport. Avoid giant KPI tiles, gradients, glass effects, oversized headings, and animated status glows.

Do **not** reproduce the sample's port counters, device metrics, or detailed cluster rows in V1. Reserve expandable/collapsible service groups for a later milestone after basic usability is proven.

## 8. Repository structure

```text
network-topology/
├── AGENTS.md                         # product constraints and working rules
├── README.md                         # quickstart and operator guide
├── docs/
│   ├── product-spec.md               # this specification
│   ├── deployment.md                 # NPM, LXC, offline transfer
│   ├── backup-restore.md
│   └── api.md
├── compose.yaml
├── .env.example
├── frontend/
│   ├── Dockerfile                    # build SPA and serve with NGINX
│   ├── nginx.conf                    # static UI + /api reverse proxy/SSE
│   ├── package.json
│   ├── package-lock.json
│   ├── scripts/generate-icons.mjs
│   ├── public/fonts/
│   └── src/
│       ├── app/                     # App, map state, routes
│       ├── api/                     # typed client, EventSource client
│       ├── features/map/            # canvas, node, edge, toolbar
│       ├── features/inspector/      # node/link/check forms
│       ├── features/icons/          # manifest lookup and fallback
│       ├── components/              # controls/dialog/toast
│       ├── styles/                  # local fonts and tokens
│       └── types/
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml                # pinned dependencies and tests
│   ├── alembic.ini
│   ├── alembic/versions/
│   ├── app/
│   │   ├── main.py                  # lifespan and routes
│   │   ├── config.py
│   │   ├── db.py
│   │   ├── models.py
│   │   ├── schemas.py
│   │   ├── api/                     # maps, nodes, links, monitors, events
│   │   ├── services/                # graph, status aggregation, event bus
│   │   └── monitoring/              # scheduler, icmp, tcp, http
│   └── tests/                       # validation, persistence, status, HTTP
└── scripts/                          # backup/restore, offline image export
```

## 9. Docker and operations

Two runtime services: `web` serves static assets and proxies API; `api` owns the SQLite DB and scheduler. Use a named local volume at `/data`. The services share an `internal: true` app network. The web gateway also joins a bridge with IP masquerading disabled for its loopback-published port; the API additionally joins a non-internal monitor-egress bridge so configured checks can reach routed targets. Only `web` publishes a port, bound to `127.0.0.1:${APP_PORT:-8080}:8080`. Supply a separate documented option for NPM in a different container network. Set `restart: unless-stopped`, healthchecks, read-only root filesystems, non-root users, dropped capabilities by default, and a writable data volume. Never mount `/var/run/docker.sock`.

For ICMP, use a bounded, fixed implementation and only add `NET_RAW` to `api` if the selected ICMP method and target LXC environment require it. Never use `privileged: true` just to get ping working. Test inside the actual LXC; nested Docker and ICMP permissions depend on host/LXC settings. Check Docker Compose availability, NPM reachability, routing from inside the container, and local volume permissions before final deployment. If Docker cannot run in that LXC, deploy the same Compose stack on a supported Linux VM/host rather than weakening isolation blindly.

The checked-in `compose.yaml` is the deployable configuration; this compact layout records its network and port boundary:

```yaml
services:
  web:
    image: ghcr.io/calebfuller102-sys/network-topology-map-web:0.1.1
    ports:
      - "127.0.0.1:${APP_PORT:-8080}:8080"
    read_only: true
    user: "101:101"
    cap_drop: [ALL]
    networks: [app, gateway]
    depends_on:
      api:
        condition: service_healthy
    restart: unless-stopped
  api:
    image: ghcr.io/calebfuller102-sys/network-topology-map-api:0.1.1
    environment:
      DATABASE_URL: sqlite:////data/topology.db
      DATABASE_PATH: /data/topology.db
    volumes:
      - topology-data:/data
    read_only: true
    user: "10001:10001"
    cap_drop: [ALL]
    networks: [app, monitor-egress]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/healthz', timeout=2)"]
      interval: 30s
      timeout: 5s
      retries: 3
volumes:
  topology-data:
networks:
  app:
    internal: true
  gateway:
    driver: bridge
    driver_opts:
      com.docker.network.bridge.enable_ip_masquerade: "false"
  monitor-egress: {}
```

The NPM overlay attaches only `web` to an existing external NPM network. The optional ICMP overlay adds only `NET_RAW`, and must be used only if target-LXC testing shows it is required. The normal connected deployment pulls the two private GHCR images; the Dockerfiles use digest-pinned bases. Build on a connected machine for the verified target platform, then use the supplied `docker save`/`docker load` scripts only when an offline archive is required. Do not build on an isolated host. The backup script uses SQLite's online backup API; restore requires the stack stopped, validates integrity, and atomically replaces the DB. Block WAN and test UI plus LAN monitoring on the target before claiming offline acceptance.

## 10. Milestones, gates, and Codex build sequence

| Milestone | Build | Exit gate |
| --- | --- | --- |
| M0 | Initialize repo, AGENTS.md, exact dependency locks, README, product spec, Compose skeleton, CI/local commands. | Clean builds and lint/typecheck commands run. |
| M1 | Dark SPA shell, tokens, top bar, inspector frame, empty state, local fonts/icons. | Visual review at desktop and narrow width; no external browser requests. |
| M2 | React Flow canvas, custom nodes/edges, drag, zoom, pan, fit, search, create/select/delete UI with fixtures. | Dense map remains legible; line types distinct. |
| M3 | SQLite/Alembic models, REST CRUD, validation, snapshot, typed API client, position/viewport persistence. | Restart and reload preserve graph; bad IPv4 and cross-map links rejected. |
| M4 | ICMP, TCP, HTTP(S) runners and scheduler with timeouts, concurrency cap, config changes, derived status. | Local test targets distinguish pass, refusal, timeout and HTTP failure without blocking other checks. |
| M5 | SSE event stream, reconnection/snapshot recovery, inspector diagnostics. | Status changes without reload and recovers after API restart. |
| M6 | Final Compose/NPM routing, least-privilege ICMP check, backup/restore scripts, offline image transfer. | Actual target LXC test, cold restart, backup restore and WAN-disconnected test pass. |
| M7 | Accessibility, usability, error/empty/loading states, bug fixes, deployment guide. | Owner can create and monitor a small real map unaided. |

Only write tests that cover meaningful risk: API validation/graph integrity, aggregation with incomplete results, scheduler update/cancellation, three network check outcomes, and SSE reconnect behavior. Add end-to-end smoke tests for creating a node/link and saving across a reload. After each milestone, run relevant checks, summarize changed files and observed behavior, and fix failures before advancing. Do not claim LXC/network checks passed from a development laptop.

## 11. Copy-ready Codex master prompt

Copy the following into Codex in a new repository, alongside this spec and the two reference screenshots. In a tool-driven session, give Codex access to the repository and screenshots. This prompt authorizes implementation in milestones; deployments to the owner's LXC need host access and its actual configuration.

```text
You are building a self-hosted, offline-capable network topology map for one operator.

Read docs/product-spec.md in full and inspect KKAuvik.png (map pane for interaction)
and d0au0jbxbsuf1.png (dark diagram for visual direction). Read AGENTS.md if it
exists. Implement the specification as the source of truth. The attached
message.txt contains the owner's exact answers. Do not copy the surrounding
Auvik dashboard or mechanically reproduce the other screenshot's fixed layout.

Core: manually create/edit/move/search/delete nodes; draw solid local and
dashed virtual/Internet links; per-node ICMP/TCP/HTTP(S) checks with configurable
seconds; live node status; SQLite persistence; local icons/fonts plus optional
trusted Iconify image lookup for typed `mdi-*` icons; Docker Compose behind
existing NGINX Proxy Manager.

Stack: React/TypeScript/Vite and @xyflow/react, FastAPI/Pydantic/SQLAlchemy/
Alembic/SQLite, asyncio checker, SSE, static NGINX gateway. Single API worker.
Two runtime containers, web and api. Do not add cloud dependencies, discovery,
SNMP, telemetry, accounts/RBAC, alerting or outage analytics in V1.

Follow milestones M0–M7 in the spec in order. First inspect the existing repo
and reconcile its structure with the proposed layout. In M0, create AGENTS.md
capturing scope and acceptance criteria. For each milestone, make concrete
changes, run its relevant typecheck/lint/tests/build, fix errors, and report
what works, how you verified it, and what remains. Continue through all
milestones feasible in this environment; do not stop after only planning or
scaffolding. If a host/network-specific gate cannot be run here, implement
the code and precise operator instructions, mark that gate unverified, and
continue other work.

Design constraints: nearly black canvas, compact rectangular cards, small
technical typography, thin neutral links, restrained cyan accents, readable
status semantics. Big map, right inspector, minimal chrome. Use valid example
IPv4 addresses; 10.0.0.270 is invalid. Support typed mdi- and si- icon IDs:
bundled assets for the local manifest, plus a trusted Iconify image lookup for
normalized mdi- IDs with a bundled fallback; never render raw user or remote
SVG markup. API and static UI must share an NPM-protected origin. Preserve
the map through restart. Show disconnected SSE state and resync on reconnect.

Implementation discipline: pin dependencies and keep secrets out of the repo;
avoid multiworker scheduler duplication; validate IPv4/ports/intervals and
cross-map links; make external checks bounded and nonblocking; no privileged
Docker container. The default gateway binding is loopback so API protection
cannot be bypassed. Include offline image export/import, NPM routing, SQLite
backup/restore, and an honest target-LXC acceptance checklist.

Start M0 now. Show only a short initial implementation plan, then work.
```

## Implementation references

- [React Flow custom nodes and handles](https://reactflow.dev/learn/customization/custom-nodes)
- [React Flow interaction/state](https://reactflow.dev/learn/concepts/adding-interactivity)
- [FastAPI SSE](https://fastapi.tiangolo.com/tutorial/server-sent-events/)
- [FastAPI lifespan](https://fastapi.tiangolo.com/advanced/events/)
- [Docker Compose service reference](https://docs.docker.com/reference/compose-file/services/)
- [Docker container capabilities](https://docs.docker.com/engine/containers/run/)
- [NGINX proxy buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [MDI package options](https://github.com/Templarian/MaterialDesign)
- [Simple Icons package](https://github.com/simple-icons/simple-icons)
