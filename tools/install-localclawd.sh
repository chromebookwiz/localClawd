#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="${1:-}"
BIN_DIR="${LOCALCLAWD_BIN_DIR:-$HOME/.local/bin}"

if [[ -z "$REPO_ROOT" ]]; then
  REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

ENTRYPOINT="$REPO_ROOT/src/entrypoints/source-cli.ts"

if [[ ! -f "$ENTRYPOINT" ]]; then
  echo "Could not find CLI entrypoint at $ENTRYPOINT" >&2
  exit 1
fi

get_bun_path() {
  if command -v bun >/dev/null 2>&1; then
    command -v bun
    return 0
  fi

  if [[ -x "$HOME/.bun/bin/bun" ]]; then
    echo "$HOME/.bun/bin/bun"
    return 0
  fi

  return 1
}

ensure_bun() {
  local bun_path
  if bun_path="$(get_bun_path)"; then
    printf '%s\n' "$bun_path"
    return 0
  fi

  echo 'Bun was not found. Installing Bun...' >&2
  curl -fsSL https://bun.sh/install | bash

  export PATH="$HOME/.bun/bin:$PATH"
  if bun_path="$(get_bun_path)"; then
    printf '%s\n' "$bun_path"
    return 0
  fi

  echo 'Bun appears to be installed, but the executable could not be located. Open a new shell and rerun the installer.' >&2
  exit 1
}

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

BUN_PATH="$(ensure_bun)"

mkdir -p "$BIN_DIR"

cat > "$BIN_DIR/localClawd" <<EOF
#!/usr/bin/env bash
export NODE_PATH="$REPO_ROOT\${NODE_PATH:+:$NODE_PATH}"
export USER_TYPE="\${USER_TYPE:-external}"
exec "$BUN_PATH" --install=auto --bun "$ENTRYPOINT" "\$@"
EOF

chmod +x "$BIN_DIR/localClawd"

for shell_file in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc"; do
  ensure_path_entry "$shell_file"
done

export PATH="$BIN_DIR:$PATH"

echo "Installed localClawd launcher at $BIN_DIR/localClawd"
echo "Ensured $BIN_DIR is present in common shell startup files."
echo "Launcher runtime: $BUN_PATH --install=auto --bun"
echo 'Open a new shell, then run: localClawd'