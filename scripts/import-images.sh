#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -f "$1" ]]; then
  printf 'Usage: bash scripts/import-images.sh <archive.tar>\n' >&2
  exit 2
fi

archive="$(cd -- "$(dirname -- "$1")" && pwd)/$(basename -- "$1")"
checksum_path="${archive}.sha256"
platform_path="${archive}.platform"
if [[ ! -f "$checksum_path" || ! -f "$platform_path" ]]; then
  printf 'Archive requires sibling .sha256 and .platform files.\n' >&2
  exit 2
fi
expected="$(<"$checksum_path")"
if [[ ! "$expected" =~ ^[[:xdigit:]]{64}$ ]]; then
  printf 'Invalid checksum file: %s\n' "$checksum_path" >&2
  exit 2
fi
actual="$(sha256sum -- "$archive" | awk '{print $1}')"
if [[ "${actual,,}" != "${expected,,}" ]]; then
  printf 'Image archive checksum does not match.\n' >&2
  exit 1
fi
declared_platform="$(<"$platform_path")"
if [[ ! "$declared_platform" =~ ^linux/[[:alnum:]_.\/-]+$ ]]; then
  printf 'Invalid platform manifest: %s\n' "$platform_path" >&2
  exit 2
fi
host_platform="$(docker info --format '{{.OSType}}/{{.Architecture}}')"
declared_architecture="${declared_platform#linux/}"
declared_architecture="${declared_architecture%%/*}"
if [[ "$host_platform" != "linux/${declared_architecture}" ]]; then
  printf 'Archive is for %s but this Docker host is %s.\n' "$declared_platform" "$host_platform" >&2
  exit 1
fi
docker image load --input "$archive"
printf 'Loaded image archive for declared platform %s.\n' "$declared_platform"
