#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "${repo_root}/scripts/compose-context.sh"
if ! topology_compose_context_init "$repo_root" "$@"; then
  topology_compose_usage "backup.sh" "[backup-directory]"
  exit 2
fi
if [[ ${#TOPOLOGY_REMAINING_ARGS[@]} -gt 1 ]]; then
  topology_compose_usage "backup.sh" "[backup-directory]"
  exit 2
fi
backup_dir="${TOPOLOGY_REMAINING_ARGS[0]:-${repo_root}/backups}"
umask 077
mkdir -p -- "$backup_dir"
backup_dir="$(cd -- "$backup_dir" && pwd)"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
artifact="${backup_dir}/network-topology-${timestamp}-$$.sqlite"
checksum="${artifact}.sha256"
context_manifest="${artifact}.compose-files"
temporary="$(mktemp "${backup_dir}/.network-topology-backup.XXXXXX")"
checksum_temporary="${temporary}.sha256"
context_temporary="${temporary}.compose-files"
trap 'rm -f -- "$temporary" "$checksum_temporary" "$context_temporary"' EXIT

if [[ -e "$artifact" || -e "$checksum" || -e "$context_manifest" ]]; then
  printf 'Refusing to overwrite an existing backup: %s\n' "$artifact" >&2
  exit 1
fi

docker compose "${TOPOLOGY_COMPOSE_ARGS[@]}" exec -T api python -m app.backup --stdout > "$temporary"
sha256sum -- "$temporary" | awk '{print $1}' > "$checksum_temporary"
topology_compose_manifest_write "$repo_root" "$context_temporary"
mv -- "$temporary" "$artifact"
mv -- "$checksum_temporary" "$checksum"
mv -- "$context_temporary" "$context_manifest"
trap - EXIT
printf 'Backup created: %s\n' "$artifact"
