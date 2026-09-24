#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -f "$1" ]]; then
  printf 'Usage: bash scripts/restore.sh <backup.sqlite>\n' >&2
  exit 2
fi

backup_path="$(cd -- "$(dirname -- "$1")" && pwd)/$(basename -- "$1")"
checksum_path="${backup_path}.sha256"
if [[ ! -f "$checksum_path" ]]; then
  printf 'Missing checksum file: %s\n' "$checksum_path" >&2
  exit 2
fi
expected="$(<"$checksum_path")"
if [[ ! "$expected" =~ ^[[:xdigit:]]{64}$ ]]; then
  printf 'Invalid checksum file: %s\n' "$checksum_path" >&2
  exit 2
fi
actual="$(sha256sum -- "$backup_path" | awk '{print $1}')"
if [[ "${actual,,}" != "${expected,,}" ]]; then
  printf 'Backup checksum does not match: %s\n' "$backup_path" >&2
  exit 1
fi

running="$(docker compose ps --status running --quiet api web)"
if [[ -n "$running" ]]; then
  printf 'Stop both api and web before restoring; no database was changed.\n' >&2
  exit 1
fi

docker compose run --rm --no-deps -T api \
  python -m app.backup --restore-stdin < "$backup_path"
docker compose up --detach api web
printf 'Restore completed and services were started. Verify health and map contents.\n'
