#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
temporary_directory="$(mktemp -d)"
trap 'rm -rf -- "$temporary_directory"' EXIT

fake_bin="${temporary_directory}/bin"
docker_log="${temporary_directory}/docker.log"
mkdir -p -- "$fake_bin"
cat > "${fake_bin}/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$DOCKER_LOG"
if [[ " $* " == *" exec -T api python -m app.backup --stdout "* ]]; then
  printf 'safe test backup'
fi
if [[ "$1" == "info" && "$2" == "--format" && "$3" == '{{.OSType}}' ]]; then
  printf 'linux'
fi
if [[ "$1" == "info" && "$2" == "--format" && "$3" == '{{.Architecture}}' ]]; then
  printf 'x86_64'
fi
EOF
chmod +x "${fake_bin}/docker"

backup_directory="${temporary_directory}/backups"
PATH="${fake_bin}:${PATH}" DOCKER_LOG="$docker_log" \
  bash "${repo_root}/scripts/backup.sh" \
    --compose-overlay compose.npm-network.yaml \
    --compose-overlay compose.icmp-capability.yaml \
    "$backup_directory" >/dev/null
backup_path="$(find "$backup_directory" -maxdepth 1 -name '*.sqlite' -print -quit)"
test -n "$backup_path"
test -f "${backup_path}.sha256"
test -f "${backup_path}.compose-files"
diff -u <(printf '%s\n' \
  'compose.yaml' \
  'compose.npm-network.yaml' \
  'compose.icmp-capability.yaml') "${backup_path}.compose-files"

PATH="${fake_bin}:${PATH}" DOCKER_LOG="$docker_log" \
  bash "${repo_root}/scripts/restore.sh" "$backup_path" >/dev/null

compose_prefix="compose -f ${repo_root}/compose.yaml -f ${repo_root}/compose.npm-network.yaml -f ${repo_root}/compose.icmp-capability.yaml"
grep -Fqx -- "${compose_prefix} exec -T api python -m app.backup --stdout" "$docker_log"
grep -Fqx -- "${compose_prefix} ps --status running --quiet api web" "$docker_log"
grep -Fqx -- "${compose_prefix} run --rm --no-deps -T api python -m app.backup --restore-stdin" "$docker_log"
grep -Fqx -- "${compose_prefix} up --detach api web" "$docker_log"

archive="${temporary_directory}/network-topology-amd64.tar"
printf 'safe test archive' > "$archive"
sha256sum -- "$archive" | awk '{print $1}' > "${archive}.sha256"
printf '%s\n' 'linux/amd64' > "${archive}.platform"
PATH="${fake_bin}:${PATH}" DOCKER_LOG="$docker_log" \
  bash "${repo_root}/scripts/import-images.sh" "$archive" >/dev/null
grep -Fqx -- "image load --input ${archive}" "$docker_log"

printf 'Restore Compose-context command test passed.\n'
