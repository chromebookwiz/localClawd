#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo 'Usage: generate-manifest.sh <version> <assets-dir> <output-dir> [repository] [download-base-url]' >&2
  exit 1
fi

VERSION="$1"
ASSETS_DIR="$2"
OUTPUT_DIR="$3"
REPOSITORY="${4:-chromebookwiz/localClawd}"
RELEASE_DOWNLOAD_BASE_URL="${5:-https://github.com}"

declare -A PLATFORM_MAP=(
  [win32-x64]='localClawd-win32-x64.exe'
  [win32-arm64]='localClawd-win32-arm64.exe'
  [linux-x64]='localClawd-linux-x64'
  [linux-arm64]='localClawd-linux-arm64'
  [darwin-x64]='localClawd-darwin-x64'
  [darwin-arm64]='localClawd-darwin-arm64'
)

VERSION_DIR="$OUTPUT_DIR/$VERSION"
mkdir -p "$VERSION_DIR"

manifest_path="$VERSION_DIR/manifest.json"
{
  printf '{\n'
  printf '  "version": "%s",\n' "$VERSION"
  printf '  "generatedAt": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "platforms": {\n'

  first=1
  for platform in "${!PLATFORM_MAP[@]}"; do
  asset_name="${PLATFORM_MAP[$platform]}"
  asset_path="$ASSETS_DIR/$asset_name"
  if [[ ! -f "$asset_path" ]]; then
    echo "Missing release asset: $asset_name" >&2
    exit 1
  fi

  checksum="$(sha256sum "$asset_path" | awk '{print $1}')"
  url="$RELEASE_DOWNLOAD_BASE_URL/$REPOSITORY/releases/download/v$VERSION/$asset_name"

    if [[ $first -eq 0 ]]; then
      printf ',\n'
    fi
    first=0

    printf '    "%s": {\n' "$platform"
    printf '      "checksum": "%s",\n' "$checksum"
    printf '      "url": "%s"\n' "$url"
    printf '    }'
  done

  printf '\n  }\n'
  printf '}\n'
} > "$manifest_path"

printf '%s\n' "$VERSION" > "$OUTPUT_DIR/latest"
printf '%s\n' "$VERSION" > "$OUTPUT_DIR/stable"

echo "Generated manifest at $manifest_path"