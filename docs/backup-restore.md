# Backup and restore contract

The API owns `/data/topology.db` and SQLite is configured for foreign keys and
WAL mode. Backups must use SQLite's online backup API, a consistent stopped
stack copy, or an equivalent procedure that accounts for `-wal` and `-shm`
files. Blindly copying only the main database file while the service is active
is not an accepted procedure.

The completed implementation must provide:

1. a backup command that writes a timestamped artifact outside the live data
   directory;
2. a restore command with an explicit stopped-stack precondition;
3. an integrity check after restore;
4. a documented smoke test proving that nodes, links, monitors, positions, and
   viewport state survive restoration.

No backup or restore operation has been run in Phase 0 because the API and
SQLite schema do not exist yet.
