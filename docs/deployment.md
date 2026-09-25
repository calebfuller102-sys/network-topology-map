# Deployment guide

This guide describes the checked-in packaging and operator procedures. The
first client installation is a standalone Docker Compose stack in the Docker
LXC; it does **not** require NGINX Proxy Manager (NPM). The default gateway is
loopback-only, so that first installation is usable from a browser on the LXC
at `http://127.0.0.1:8080` and is not exposed to the LAN. NPM remains an
optional later hardening and remote-access path.

This guide does not claim that the owner's Docker LXC, routes, monitored
devices, or optional NPM configuration have been tested. Complete the
acceptance checklist at the end on the target host.

## Container and network layout

- `web` is a non-root static NGINX gateway, listens on container port `8080`,
  serves the SPA, and proxies `/api/` to `api:8000`. The host publishes only
  `127.0.0.1:${APP_PORT:-8080}:8080`. It shares the internal `app` network and
  also joins a dedicated `gateway` bridge with IP masquerading disabled so the
  host can publish the loopback port without granting normal outbound NAT.
- `api` has no published host port. It and `web` share the `app` network, which
  is marked `internal: true`. The API alone also joins `monitor-egress`, a
  normal bridge network required for configured checks to reach routed IPv4
  targets. This is API-only monitor-egress membership, not a destination
  allowlist; actual LAN/WAN routes and firewall policy depend on the host.
- Both containers use read-only root filesystems, non-root UIDs, dropped Linux
  capabilities, and writable `/tmp` tmpfs mounts. The API data volume is the
  only persistent write mount. There is no privileged container or Docker
  socket mount.
- The web image disables NGINX response buffering for the SSE route and uses a
  one-hour proxy timeout. It uses Docker's embedded DNS with a five-second
  cache for the API upstream, so a replaced API container can recover without
  recreating `web`. If NPM is added later, it must preserve that path and
  protect the UI, API, and SSE on the same origin.

The images use immutable base-image digests, a pinned Python lockfile, the
frontend pnpm lockfile, and a fixed `iputils-ping` package version. Runtime
images are published to the repository's private GitHub Container Registry
(GHCR) packages. Pull them with Compose on a connected host, or use the
separate archive procedure for an offline host.

## First client installation: pull from GitHub Container Registry

The client needs `compose.yaml`, `.env.example`, and the deployment and
backup/restore guides. The Compose file pulls these two `linux/amd64` images:

- `ghcr.io/calebfuller102-sys/network-topology-map-web:0.1.0`
- `ghcr.io/calebfuller102-sys/network-topology-map-api:0.1.0`

They are public GHCR packages linked to this public repository, so the client
does not need a GitHub login or token to pull them. If package visibility is
ever changed back to private, the client must authenticate with an account that
has package access and a classic `read:packages` token. Do not put a token in
`.env`, Compose YAML, source control, or shell history.

The SQLite data is stored in Docker's named `topology-data` volume (normally
`network-topology_topology-data`, because the checked-in Compose project is
named `network-topology`). It survives `docker compose down` unless
`--volumes` is explicitly supplied. Do not use `down --volumes` for the live
client stack.

On the connected Docker-enabled LXC, authenticate, pull, and start:

```sh
cp .env.example .env
docker compose pull
docker compose up --detach
docker compose ps
```

Open `http://127.0.0.1:8080` in a browser running on the LXC. If the browser
runs on another computer, do not change the loopback bind casually: use the
LXC console, a managed tunnel, or add and test an authenticated reverse proxy
later. The API has no host port in either case.

The image publication workflow publishes only `linux/amd64` images and tags
both images with the requested release tag and their source commit, then marks
the linked packages public. GitHub documents that public GHCR packages can be
pulled anonymously; private packages require an authenticated account and a
`read:packages` classic token.

## Connected developer build

On a connected Docker host, from the repository root:

```sh
docker compose -f compose.yaml -f compose.build.yaml build --pull
docker compose up --detach --pull never
docker compose ps
```

This is a **first-time connected build**, not an offline build. It may download
the digest-pinned base images and build-time OS, Python, and frontend packages.
It must not be run on a disconnected client LXC.

A genuinely offline rebuild has not been tested or supported. It would require
the exact base images and every build dependency/cache to be preloaded, then a
separate no-network build test. The supported offline operation is import and
start of the prebuilt archive below, not `docker compose build`.

The default gateway is available on the host at `http://127.0.0.1:8080`.
Set `APP_PORT` to change the loopback port. The API is not published directly.
For upgrades that run Alembic migrations, take a backup first. Existing M0–M5
volumes may be owned by root because the earlier API image ran as root; after
building and stopping the old services, migrate that volume's ownership once:

```sh
docker compose stop web api
docker compose run --rm --no-deps --user 0 --cap-add CHOWN api \
  chown -R 10001:10001 /data
docker compose up --detach
```

This changes ownership, not database content. Skip it for a fresh volume or a
volume already owned by UID/GID `10001`.

## Optional later: NGINX Proxy Manager

If NPM runs on the Docker host and can reach host loopback, point its proxy host
to `127.0.0.1`, port `${APP_PORT:-8080}`. Apply the same access-control policy
to the whole origin, including `/api/` and the EventSource stream. Do not expose
the API port.

If NPM runs in another container, first identify its existing Docker network.
Then attach only the gateway to that external network with the supplied
overlay (do not create a second NPM stack or assume host-loopback routing):

```sh
NPM_DOCKER_NETWORK=npm_proxy docker compose \
  -f compose.yaml -f compose.npm-network.yaml up --detach
```

Replace `npm_proxy` with the actual pre-existing network name. Configure NPM to
proxy to `network-topology-web:8080`. The alias is provided by the overlay; the
API remains isolated from the NPM network. NPM's actual authentication, TLS,
and routing behavior still needs target-host verification.

## ICMP capability

The default API service drops all capabilities. First test the packaged `ping`
utility in the actual target LXC. Only if that test proves ICMP needs raw-socket
permission, apply the optional one-capability overlay:

```sh
docker compose -f compose.yaml -f compose.icmp-capability.yaml up --detach
```

Do not use `privileged: true`. Whether nested Docker permits this capability is
host/LXC-specific and is not verified by the repository tests.

## Building an offline image handoff

On a connected Docker Buildx host, obtain the actual target CPU platform from
the owner/target host; do not infer it from the build machine. Export both
images for that exact platform:

```sh
bash scripts/export-images.sh linux/amd64
```

Replace `linux/amd64` with the verified platform (for example `linux/arm64`).
The script builds from the digest-pinned Dockerfiles, inspects the resulting
image architecture, and writes an image archive plus `.sha256` and `.platform`
sidecars under the ignored `transfer/` directory. Transfer those three files
and a trusted copy of the Compose YAML files to the disconnected host using the
owner's approved channel. Keep the archive private; it contains the application
and bundled topology code. The source bundle and local assets must also be
available on that host for Compose configuration/scripts; no online package
installation is needed at runtime. This is an offline **installation**, not an
offline image build.

On the offline host, verify/load the exact archive and start without building
or attempting a registry pull:

```sh
bash scripts/import-images.sh transfer/network-topology-amd64-<timestamp>.tar
docker compose up --detach --no-build --pull never
```

The import script checks the SHA-256 sidecar and rejects a platform mismatch.
`--pull never` makes startup fail rather than contact the registry when a
matching image was not loaded. Keep a tested copy of the image archive with the
matching Compose files for rollback. The CI runner tests import and no-pull
startup, but it is not WAN-disconnected; a fully air-gapped target-LXC
installation remains an acceptance check.

When the optional NPM or ICMP capability overlay is enabled, use that exact
Compose file set for start, backup, and restore. The default standalone client
installation uses only `compose.yaml`. The backup/restore scripts accept
`--compose-overlay compose.npm-network.yaml` and
`--compose-overlay compose.icmp-capability.yaml`; pass only the overlays in
use. New backups record this context in a private `.compose-files` sidecar,
which must accompany the SQLite file and its checksum.

## Target acceptance checklist (not yet verified)

- Record LXC OS, CPU platform, Docker Engine/Compose versions, rootless/rootful
  mode, and whether nested containers are enabled.
- Confirm gateway health, API health, a cold container restart, and persistent
  map data after restart. Confirm the local LXC browser can reach
  `http://127.0.0.1:8080` and that the named `topology-data` volume survives a
  normal stop/start.
- From inside the actual API container, confirm routes and check outcomes for
  representative intended LAN targets. Confirm a slow/unreachable target does
  not stall other checks.
- Test ICMP without extra capabilities first; add only `NET_RAW` if the target
  proves it necessary and permits it.
- If remote access is later required, verify NPM can reach the gateway,
  authentication covers `/api` and SSE, and SSE updates survive its proxy path
  without buffering or premature timeout. This is not a prerequisite for the
  loopback-only first client installation.
- Perform a backup and restore smoke test using [backup-restore.md](backup-restore.md).
- With WAN disconnected, load and edit the UI, exercise local assets, persist a
  topology, monitor reachable LAN targets, and inspect browser requests. Do not
  call this offline gate passed until it has been done on the target setup.

HTTPS checks connect to the configured IPv4 URL. Certificate verification
requires the certificate's Subject Alternative Name to contain that IP; an
HTTP `Host` header does not set TLS SNI. Do not disable verification as a
workaround. An IP-SAN endpoint or a separately designed server-name field is
needed for HTTPS virtual hosting by DNS name.
