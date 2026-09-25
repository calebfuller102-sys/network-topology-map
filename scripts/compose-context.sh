#!/usr/bin/env bash
# Shared Compose-file handling for the backup and restore scripts. Source this
# file; it intentionally does not run Docker by itself.

topology_compose_usage() {
  local command_name="$1"
  local argument_name="$2"
  printf 'Usage: bash scripts/%s [--compose-overlay <file>]... %s\n' \
    "$command_name" "$argument_name" >&2
}

topology_compose_context_init() {
  local repo_root="$1"
  shift

  TOPOLOGY_COMPOSE_OVERLAYS=()
  while [[ $# -ge 2 && "$1" == "--compose-overlay" ]]; do
    local supplied_path="$2"
    local absolute_path
    if [[ "$supplied_path" = /* ]]; then
      absolute_path="$supplied_path"
    else
      absolute_path="${repo_root}/${supplied_path}"
    fi
    if [[ ! -f "$absolute_path" ]]; then
      printf 'Compose overlay does not exist: %s\n' "$supplied_path" >&2
      return 2
    fi
    absolute_path="$(cd -- "$(dirname -- "$absolute_path")" && pwd)/$(basename -- "$absolute_path")"
    case "$absolute_path" in
      "${repo_root}"/*) ;;
      *)
        printf 'Compose overlays must be inside the repository: %s\n' "$supplied_path" >&2
        return 2
        ;;
    esac
    TOPOLOGY_COMPOSE_OVERLAYS+=("$absolute_path")
    shift 2
  done

  TOPOLOGY_REMAINING_ARGS=("$@")
  TOPOLOGY_COMPOSE_FILES=("${repo_root}/compose.yaml" "${TOPOLOGY_COMPOSE_OVERLAYS[@]}")
  TOPOLOGY_COMPOSE_ARGS=()
  local compose_file
  for compose_file in "${TOPOLOGY_COMPOSE_FILES[@]}"; do
    TOPOLOGY_COMPOSE_ARGS+=( -f "$compose_file" )
  done
}

topology_compose_manifest_write() {
  local repo_root="$1"
  local manifest_path="$2"
  local compose_file
  : > "$manifest_path"
  for compose_file in "${TOPOLOGY_COMPOSE_FILES[@]}"; do
    printf '%s\n' "${compose_file#"${repo_root}/"}" >> "$manifest_path"
  done
}

topology_compose_manifest_load() {
  local repo_root="$1"
  local manifest_path="$2"
  local -a manifest_files=()
  mapfile -t manifest_files < "$manifest_path"
  if [[ ${#manifest_files[@]} -eq 0 || "${manifest_files[0]}" != "compose.yaml" ]]; then
    printf 'Invalid Compose context manifest: %s\n' "$manifest_path" >&2
    return 2
  fi

  TOPOLOGY_COMPOSE_FILES=()
  TOPOLOGY_COMPOSE_ARGS=()
  local relative_path
  for relative_path in "${manifest_files[@]}"; do
    if [[ -z "$relative_path" || "$relative_path" = /* || "$relative_path" == *".."* ]]; then
      printf 'Invalid Compose file entry in manifest: %s\n' "$relative_path" >&2
      return 2
    fi
    local absolute_path="${repo_root}/${relative_path}"
    if [[ ! -f "$absolute_path" ]]; then
      printf 'Compose file from backup context is unavailable: %s\n' "$relative_path" >&2
      return 2
    fi
    TOPOLOGY_COMPOSE_FILES+=("$absolute_path")
    TOPOLOGY_COMPOSE_ARGS+=( -f "$absolute_path" )
  done
}
