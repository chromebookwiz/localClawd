#!/usr/bin/env bash

set -euo pipefail

REPOSITORY="${LOCALCLAWD_REPOSITORY:-chromebookwiz/localClawd}"
BRANCH="${LOCALCLAWD_BRANCH:-main}"
INSTALL_ROOT="${LOCALCLAWD_INSTALL_ROOT:-$HOME/.localClawd/source}"
BIN_DIR="${LOCALCLAWD_BIN_DIR:-$HOME/.local/bin}"
VERSION="${LOCALCLAWD_VERSION:-}"
CHANNEL="${LOCALCLAWD_CHANNEL:-latest}"
RELEASE_DOWNLOAD_BASE_URL="${LOCALCLAWD_RELEASE_DOWNLOAD_BASE_URL:-https://github.com}"
DISABLE_SOURCE_FALLBACK="${LOCALCLAWD_DISABLE_SOURCE_FALLBACK:-0}"

TEMP_ROOT="$(mktemp -d)"
ARCHIVE_PATH="$TEMP_ROOT/localclawd.tar.gz"
EXTRACT_ROOT="$TEMP_ROOT/extract"
DOWNLOAD_URL="https://github.com/$REPOSITORY/archive/refs/heads/$BRANCH.tar.gz"

cleanup() {
  rm -rf "$TEMP_ROOT"
}

trap cleanup EXIT

mkdir -p "$EXTRACT_ROOT"

ensure_path_entry() {
  local shell_file="$1"
  local export_line
  export_line="export PATH=\"$BIN_DIR:\$PATH\""

  if [[ ! -f "$shell_file" ]]; then
    printf '%s\n' "$export_line" > "$shell_file"
    return 0
  fi

  if ! grep -Fq "$export_line" "$shell_file"; then
    printf '\n%s\n' "$export_line" >> "$shell_file"
  fi
}

get_platform_asset_name() {
  local os
  local arch

  case "$(uname -s)" in
    Linux) os='linux' ;;
    Darwin) os='darwin' ;;
    *)
      echo "Unsupported operating system for release install: $(uname -s)" >&2
      return 1
      ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64) arch='x64' ;;
    arm64|aarch64) arch='arm64' ;;
    *)
      echo "Unsupported architecture for release install: $(uname -m)" >&2
      return 1
      ;;
  esac

  printf 'localClawd-%s-%s\n' "$os" "$arch"
}

install_release_asset() {
  local asset_name
  asset_name="$(get_platform_asset_name)" || return 1

  local installed_binary="$BIN_DIR/localClawd"
  local downloaded_asset="$TEMP_ROOT/$asset_name"
  local urls=()

  if [[ -n "$VERSION" ]]; then
    urls+=(
      "$RELEASE_DOWNLOAD_BASE_URL/$REPOSITORY/releases/download/v$VERSION/$asset_name"
      "$RELEASE_DOWNLOAD_BASE_URL/$REPOSITORY/releases/download/$VERSION/$asset_name"
    )
  else
    urls+=("$RELEASE_DOWNLOAD_BASE_URL/$REPOSITORY/releases/latest/download/$asset_name")
  fi

  mkdir -p "$BIN_DIR"

  for url in "${urls[@]}"; do
    echo "Trying release asset: $url"
    if curl -fsSL "$url" -o "$downloaded_asset"; then
      install -m 755 "$downloaded_asset" "$installed_binary"
      for shell_file in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc"; do
        ensure_path_entry "$shell_file"
      done
      export PATH="$BIN_DIR:$PATH"
      echo "Installed localClawd release binary to $installed_binary"
      if [[ -n "$VERSION" ]]; then
        echo "Installed requested release version: $VERSION"
      else
        echo "Installed release channel: $CHANNEL"
      fi
      return 0
    fi
    echo "Release asset unavailable at $url"
  done

  return 1
}

if install_release_asset; then
  exit 0
fi

if [[ "$DISABLE_SOURCE_FALLBACK" == '1' ]]; then
  echo 'No matching release asset was found and source fallback is disabled.' >&2
  exit 1
fi

echo 'No release asset found. Falling back to source-checkout installation.'

echo "Downloading $REPOSITORY ($BRANCH)..."
curl -fsSL "$DOWNLOAD_URL" -o "$ARCHIVE_PATH"

echo 'Extracting source bundle...'
tar -xzf "$ARCHIVE_PATH" -C "$EXTRACT_ROOT"

CHECKOUT="$(find "$EXTRACT_ROOT" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
if [[ -z "$CHECKOUT" ]]; then
  echo 'Could not locate extracted localClawd source.' >&2
  exit 1
fi

rm -rf "$INSTALL_ROOT"
mkdir -p "$(dirname "$INSTALL_ROOT")"
mv "$CHECKOUT" "$INSTALL_ROOT"

INSTALLER="$INSTALL_ROOT/tools/install-localclawd.sh"
if [[ ! -f "$INSTALLER" ]]; then
  echo "Installer script not found at $INSTALLER" >&2
  exit 1
fi

echo 'Running localClawd installer...'
bash "$INSTALLER" "$INSTALL_ROOT"