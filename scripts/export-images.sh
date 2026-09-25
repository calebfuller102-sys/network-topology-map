#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 || ! "$1" =~ ^linux/[[:alnum:]_.\/-]+$ ]]; then
  printf 'Usage: bash scripts/export-images.sh linux/<target-architecture> [archive.tar]\n' >&2
  exit 2
fi

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
umask 077
platform="$1"
platform_slug="${platform#linux/}"
platform_slug="${platform_slug//\//-}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="${2:-${repo_root}/transfer/network-topology-${platform_slug}-${timestamp}.tar}"
mkdir -p -- "$(dirname -- "$archive")"
archive_dir="$(cd -- "$(dirname -- "$archive")" && pwd)"
archive="${archive_dir}/$(basename -- "$archive")"
checksum="${archive}.sha256"
platform_file="${archive}.platform"

if [[ -e "$archive" || -e "$checksum" || -e "$platform_file" ]]; then
  printf 'Refusing to overwrite an existing transfer artifact.\n' >&2
  exit 1
fi

docker buildx build --pull --platform "$platform" --load \
  --tag ghcr.io/calebfuller102-sys/network-topology-map-api:0.1.1 --file "$repo_root/backend/Dockerfile" \
  "$repo_root/backend"
docker buildx build --pull --platform "$platform" --load \
  --tag ghcr.io/calebfuller102-sys/network-topology-map-web:0.1.1 --file "$repo_root/frontend/Dockerfile" \
  "$repo_root"

expected_architecture="${platform#linux/}"
expected_architecture="${expected_architecture%%/*}"
for image in \
  ghcr.io/calebfuller102-sys/network-topology-map-api:0.1.1 \
  ghcr.io/calebfuller102-sys/network-topology-map-web:0.1.1; do
  image_platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")"
  if [[ "$image_platform" != "linux/${expected_architecture}" ]]; then
    printf 'Built %s for %s, expected %s.\n' "$image" "$image_platform" "$platform" >&2
    exit 1
  fi
done

temporary="$(mktemp "${archive_dir}/.network-topology-images.XXXXXX")"
trap 'rm -f -- "$temporary" "${temporary}.sha256" "${temporary}.platform"' EXIT
docker image save --output "$temporary" \
  ghcr.io/calebfuller102-sys/network-topology-map-api:0.1.1 \
  ghcr.io/calebfuller102-sys/network-topology-map-web:0.1.1
sha256sum -- "$temporary" | awk '{print $1}' > "${temporary}.sha256"
printf '%s\n' "$platform" > "${temporary}.platform"
mv -- "$temporary" "$archive"
mv -- "${temporary}.sha256" "$checksum"
mv -- "${temporary}.platform" "$platform_file"
trap - EXIT
printf 'Images exported for %s: %s\n' "$platform" "$archive"
