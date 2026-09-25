#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "${repo_root}/scripts/compose-context.sh"
if ! topology_compose_context_init "$repo_root" "$@"; then
  topology_compose_usage "restore.sh" "<backup.sqlite>"
  exit 2
fi
if [[ ${#TOPOLOGY_REMAINING_ARGS[@]} -ne 1 || ! -f "${TOPOLOGY_REMAINING_ARGS[0]}" ]]; then
  topology_compose_usage "restore.sh" "<backup.sqlite>"
  exit 2
fi

backup_path="$(cd -- "$(dirname -- "${TOPOLOGY_REMAINING_ARGS[0]}")" && pwd)/$(basename -- "${TOPOLOGY_REMAINING_ARGS[0]}")"
checksum_path="${backup_path}.sha256"
context_manifest="${backup_path}.compose-files"
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

if [[ ${#TOPOLOGY_COMPOSE_OVERLAYS[@]} -eq 0 && -f "$context_manifest" ]]; then
  topology_compose_manifest_load "$repo_root" "$context_manifest"
elif [[ ${#TOPOLOGY_COMPOSE_OVERLAYS[@]} -eq 0 ]]; then
  printf 'Backup has no Compose context manifest; restoring with compose.yaml only.\n' >&2
fi

running="$(docker compose "${TOPOLOGY_COMPOSE_ARGS[@]}" ps --status running --quiet api web)"
if [[ -n "$running" ]]; then
  printf 'Stop both api and web before restoring; no database was changed.\n' >&2
  exit 1
fi

docker compose "${TOPOLOGY_COMPOSE_ARGS[@]}" run --rm --no-deps -T api \
  python -m app.backup --restore-stdin < "$backup_path"
docker compose "${TOPOLOGY_COMPOSE_ARGS[@]}" up --detach api web
printf 'Restore completed and services were started. Verify health and map contents.\n'
