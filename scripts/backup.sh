#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
backup_dir="${1:-${repo_root}/backups}"
umask 077
mkdir -p -- "$backup_dir"
backup_dir="$(cd -- "$backup_dir" && pwd)"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
artifact="${backup_dir}/network-topology-${timestamp}-$$.sqlite"
checksum="${artifact}.sha256"
temporary="$(mktemp "${backup_dir}/.network-topology-backup.XXXXXX")"
checksum_temporary="${temporary}.sha256"
trap 'rm -f -- "$temporary" "$checksum_temporary"' EXIT

if [[ -e "$artifact" || -e "$checksum" ]]; then
  printf 'Refusing to overwrite an existing backup: %s\n' "$artifact" >&2
  exit 1
fi

docker compose exec -T api python -m app.backup --stdout > "$temporary"
sha256sum -- "$temporary" | awk '{print $1}' > "$checksum_temporary"
mv -- "$temporary" "$artifact"
mv -- "$checksum_temporary" "$checksum"
trap - EXIT
printf 'Backup created: %s\n' "$artifact"
