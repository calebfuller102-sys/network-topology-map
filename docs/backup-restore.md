# SQLite backup and restore

The API owns `/data/topology.db` on the named Compose volume. SQLite uses WAL
mode, so do not copy only the live database file. `scripts/backup.sh` asks the
running API container to use SQLite's online backup API, validates the copied
database, writes it outside `/data`, and emits a SHA-256 sidecar. The default
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

Copy both `*.sqlite` and its `*.sqlite.sha256` file to the protected backup
location. The script uses a temporary file and refuses to overwrite its
timestamped artifact.

## Restore

Restoring replaces the current database and requires both `api` and `web` to
be stopped. The script verifies the checksum, validates SQLite's file header
and `PRAGMA integrity_check` before changing the target, atomically swaps the
database file, and starts the services only after restore succeeds:

```sh
docker compose stop web api
bash scripts/restore.sh backups/network-topology-<timestamp>-<pid>.sqlite
```

Do not run the restore module directly against an active database. If restore
validation fails, the existing database is left in place and the stack remains
stopped for investigation.

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
