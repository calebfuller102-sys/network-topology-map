# SQLite backup and restore

The API owns `/data/topology.db` on the named Compose volume. SQLite uses WAL
mode, so do not copy only the live database file. `scripts/backup.sh` asks the
running API container to use SQLite's online backup API, validates the copied
database, writes it outside `/data`, and emits SHA-256 and Compose-context
sidecars. The default
`backups/` directory is ignored by Git and artifacts are created with private
permissions. Keep backups encrypted/private according to the sensitivity of
the topology they contain.

## Create a backup

With the API healthy, from the repository root:

```sh
bash scripts/backup.sh
```

An optional first argument chooses a destination directory:

```sh
bash scripts/backup.sh /secure/off-host/network-topology
```

Copy the `*.sqlite`, `*.sqlite.sha256`, and `*.sqlite.compose-files` sidecars
to the protected backup location. The Compose-context sidecar records the base
file and any selected overlays so restore starts the same service and network
shape. The script uses temporary files and refuses to overwrite its timestamped
artifacts.

### Standalone client installation and Compose overlays

The loopback-only first client installation uses `compose.yaml` alone, so its
backup command needs no overlay flag:

```sh
bash scripts/backup.sh
```

Pass every optional overlay actually used for deployment to backup. The base
`compose.yaml` is always included:

```sh
bash scripts/backup.sh \
  --compose-overlay compose.npm-network.yaml \
  --compose-overlay compose.icmp-capability.yaml
```

Only include an overlay that is actually enabled. For an NPM overlay, retain
the same `NPM_DOCKER_NETWORK` environment value used for deployment. The
backup records the selected file names, so later restore does not silently omit
NPM or the optional ICMP capability.

## Restore

Restoring replaces the current database and requires both `api` and `web` to
be stopped. The script verifies the checksum, validates SQLite's file header
and `PRAGMA integrity_check` before changing the target, atomically swaps the
database file, and starts the services only after restore succeeds:

```sh
docker compose stop web api
bash scripts/restore.sh backups/network-topology-<timestamp>-<pid>.sqlite
```

If deployment uses overlays, stop with the same file set and preserve any
required environment values before restoring. For example, for both optional
overlays:

```sh
NPM_DOCKER_NETWORK=npm_proxy docker compose \
  -f compose.yaml -f compose.npm-network.yaml -f compose.icmp-capability.yaml \
  stop web api
NPM_DOCKER_NETWORK=npm_proxy bash scripts/restore.sh \
  backups/network-topology-<timestamp>-<pid>.sqlite
```

Do not run the restore module directly against an active database. If restore
validation fails, the existing database is left in place and the stack remains
stopped for investigation. Restore reads the backup's `.compose-files` sidecar
by default. If an older backup lacks the sidecar, it warns and uses only
`compose.yaml`. To deliberately override a recorded context, provide the exact
overlay set explicitly:

```sh
bash scripts/restore.sh \
  --compose-overlay compose.npm-network.yaml \
  --compose-overlay compose.icmp-capability.yaml \
  backups/network-topology-<timestamp>-<pid>.sqlite
```

## Upgrade rollback

Before an upgrade, make a backup and retain the matching image archive and
Compose files. To roll back a standalone client installation, stop the stack,
load the earlier verified image archive, then restore the backup made at that
same version:

```sh
docker compose stop web api
bash scripts/import-images.sh transfer/network-topology-amd64-<previous>.tar
bash scripts/restore.sh backups/network-topology-<previous>.sqlite
```

`restore.sh` starts `api` and `web` after validation. Do not restore a database
from a newer schema into an older application image. If optional overlays were
in use, the backup sidecar preserves them; retain the required environment
values such as `NPM_DOCKER_NETWORK`.

## Restore smoke test

For a non-destructive test, restore into a separate Compose project so it gets
its own named volume and loopback port. Replace the path with the absolute path
to a real backup artifact:

```sh
COMPOSE_PROJECT_NAME=network-topology-restore-test APP_PORT=18080 \
  bash scripts/restore.sh /secure/path/network-topology-<timestamp>-<pid>.sqlite
```

Open `http://127.0.0.1:18080`, reload the map, and confirm its nodes, links,
relative positions, and viewport. Use the snapshot response
(`/api/v1/maps/{map_id}/snapshot`) and the inspector's monitor editor to compare
monitor definitions and latest results. Confirm the services become healthy.
After recording the result, remove only the test project's
containers and volume (the test project name is explicit above):

```sh
COMPOSE_PROJECT_NAME=network-topology-restore-test docker compose down --volumes
```

Do not use `down --volumes` against the production project: that removes the
live database. A smoke test should be performed on the actual target Docker
host before calling M6's restore gate complete.
