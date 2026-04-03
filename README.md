# localClawd

localClawd is a local-first fork of Claude Code. It keeps the terminal-first coding workflow, tool loop, agents, and computer-use model from Claude Code, but swaps the hosted Claude dependency for user-controlled backends such as vLLM, Ollama, and other OpenAI-compatible endpoints.

The intent is not to rebuild the product from scratch. The intent is to keep the parts Claude Code got right, then expand them for self-hosted and gateway-based local inference.

## What localClawd adds on top

- In-app local backend setup: onboarding and `/config` now let you choose the provider, endpoint base URL, model, and optional API key without relying only on environment variables.
- OpenAI-compatible transport layer: internal Claude-style requests are translated to `/v1/chat/completions`, so the CLI can talk to vLLM, Ollama, and similar gateways.
- vLLM-first defaults: the default local backend path assumes an OpenAI-compatible vLLM server rather than a hosted Claude endpoint.
- Expanded backend support: Ollama and generic OpenAI-compatible endpoints are first-class options alongside vLLM.
- Backend health diagnostics: `localClawd doctor` now checks whether the configured local backend is reachable and reports the endpoint, model, auth state, and last probe result.
- Local-model context controls: setup includes a compact-context cap for models that degrade before their advertised context window.
- Multimodal passthrough for local models: pasted images and browser/computer-use screenshots flow through when the selected backend model supports them.
- Local-first install branding: the launcher, onboarding, prompts, and bundled naming are reworked around `localClawd`.

## Quick start

By default, localClawd targets a vLLM-compatible endpoint. During onboarding, the CLI now asks you which backend to use, what base URL to call, and which model to select.

## Setup

### Windows

One-line GitHub install in PowerShell:

```powershell
curl.exe -fsSL https://raw.githubusercontent.com/chromebookwiz/localClawd/main/tools/bootstrap-localclawd.ps1 | powershell -NoProfile -ExecutionPolicy Bypass -Command -
```

PowerShell-native equivalent:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/chromebookwiz/localClawd/main/tools/bootstrap-localclawd.ps1').Content))"
```

From an existing checkout:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\install-localclawd.ps1
```

The bootstrap installer downloads the current source bundle, bootstraps Bun with `winget` if needed, then adds a `localClawd` launcher to your user PATH. On Windows, use `curl.exe` instead of `curl` inside PowerShell because `curl` is an alias for `Invoke-WebRequest` there.

The install location is derived from each user's home directory, so the same `curl` command works for other users too. On Windows it defaults to `%USERPROFILE%\.localClawd\source` for the source checkout and `%USERPROFILE%\.local\bin` for the launchers.

### Linux

Linux setup currently uses a source checkout plus Bun.

1. Install Bun.
2. Clone the repository.
3. Run the source entrypoint from the checkout.

Example:

```bash
curl -fsSL https://bun.sh/install | bash
git clone https://github.com/chromebookwiz/localClawd.git ~/.localClawd/source
cd ~/.localClawd/source
bun --bun src/entrypoints/source-cli.ts --help
```

Optional launcher:

```bash
mkdir -p ~/.local/bin
cat > ~/.local/bin/localClawd <<'EOF'
#!/usr/bin/env bash
exec bun --bun "$HOME/.localClawd/source/src/entrypoints/source-cli.ts" "$@"
EOF
chmod +x ~/.local/bin/localClawd
```

Default Linux paths:

- Source checkout: `~/.localClawd/source`
- Optional launcher: `~/.local/bin/localClawd`

### macOS

macOS setup is the same as Linux today: install Bun, clone the repository, then run the source entrypoint or add a small launcher script.

Example:

```bash
curl -fsSL https://bun.sh/install | bash
git clone https://github.com/chromebookwiz/localClawd.git ~/.localClawd/source
cd ~/.localClawd/source
bun --bun src/entrypoints/source-cli.ts --help
```

Optional launcher:

```bash
mkdir -p ~/.local/bin
cat > ~/.local/bin/localClawd <<'EOF'
#!/usr/bin/env bash
exec bun --bun "$HOME/.localClawd/source/src/entrypoints/source-cli.ts" "$@"
EOF
chmod +x ~/.local/bin/localClawd
```

If `~/.local/bin` is not already on your shell `PATH`, add it in your shell profile such as `~/.zshrc` or `~/.bashrc`.

### Backend setup after install

localClawd accepts native environment variable names. Legacy `CLAUDE_CODE_*` names are still accepted as compatibility aliases, but new setups should prefer `LOCALCLAWD_*`.

Most users should configure the backend during first-run onboarding or later in `/config`. Environment variables still work when you want non-interactive setup, shell-specific overrides, or CI automation.

For vLLM:

```powershell
$env:LOCALCLAWD_USE_VLLM = '1'
$env:LOCALCLAWD_LOCAL_BASE_URL = 'http://127.0.0.1:8000/v1'
$env:LOCALCLAWD_LOCAL_MODEL = 'qwen2.5-coder-32b-instruct'
```

For Ollama:

```powershell
$env:LOCALCLAWD_USE_OLLAMA = '1'
$env:LOCALCLAWD_LOCAL_BASE_URL = 'http://127.0.0.1:11434/v1'
$env:LOCALCLAWD_LOCAL_MODEL = 'qwen2.5-coder:32b'
```

Optional:

```powershell
$env:LOCALCLAWD_LOCAL_API_KEY = 'anything'
```

Then run:

```powershell
localClawd
```

## Installation

This repository currently contains the source tree and assets for localClawd, but it does not yet include package-manager metadata or release automation files in-tree. That means there are two practical install paths today:

1. Use a prebuilt `localClawd` binary for your platform once release artifacts are published for this fork.
2. Run localClawd from a source checkout with Bun, or use a locally built `localClawd` executable from your own development workflow, then use the native installer command below to place it in your user bin directory.

### Native install

If you already have a runnable `localClawd` executable, install it natively with:

```powershell
localClawd install
```

That installs the stable launcher to:

- Unix-like systems: `~/.local/bin/localClawd`
- Windows: `%USERPROFILE%\.local\bin\localClawd.exe`

After installation, verify the CLI is on your path:

```powershell
localClawd --version
localClawd doctor
```

To update an existing native install:

```powershell
localClawd update
```

### Power tools

- `tools\install-localclawd.ps1` bootstraps Bun if needed, creates a launcher for this checkout, and adds the launcher directory to your user PATH.
- `tools\bootstrap-localclawd.ps1` downloads the repository source bundle, installs a checkout under `~/.localClawd/source`, and then runs the local installer.
- `tools\rebrand-localclawd.ps1` aggressively rewrites `Claude` and `claude` occurrences across the repo to `localClawd`.
- `tools\localclawd-tools.ps1` wraps install, rebrand, and branding audit in a single entrypoint.

### Backend environment variables

localClawd currently recognizes both native and legacy variable names for the local backend configuration. Prefer the native names below for new setups:

- `LOCALCLAWD_USE_SPARK`
- `LOCALCLAWD_USE_VLLM`
- `LOCALCLAWD_USE_OLLAMA`
- `LOCALCLAWD_USE_OPENAI`
- `LOCALCLAWD_LOCAL_BASE_URL`
- `LOCALCLAWD_LOCAL_MODEL`
- `LOCALCLAWD_LOCAL_API_KEY`
- `LOCALCLAWD_AUTO_COMPACT_WINDOW`

Legacy compatibility aliases that still work:

- `LOCALCLAWD_USE_SPARK` and `CLAUDE_CODE_USE_SPARK` are treated as vLLM aliases.
- `CLAUDE_CODE_USE_OPENAI` is accepted as a compatibility alias for `LOCALCLAWD_USE_OPENAI`.
- Existing legacy environment variable aliases from the upstream fork are still accepted.

### Production checklist

For a production-style rollout of this fork:

1. Build and publish platform binaries named `localClawd`.
2. Verify `localClawd install`, `localClawd update`, and `localClawd doctor` against those release artifacts.
3. Keep the legacy env aliases enabled until downstream wrappers and scripts have migrated.

## Installation flow

The native install and update commands are exposed directly from the CLI:

```powershell
localClawd install
localClawd update
localClawd doctor
```

The native installer places the executable at `~/.local/bin/localClawd` on Unix-like systems and `%USERPROFILE%\.local\bin\localClawd.exe` on Windows.

## Compact context window

During first-run setup, localClawd asks for a compact context window cap. Use this when your local model becomes unstable before its advertised maximum context size. You can change it later in `/config` under `Compact context window`.

## Why use it instead of stock Claude Code

- You can point the CLI at your own inference stack instead of a Claude-hosted backend.
- Backend configuration lives inside the app, not only in shell variables.
- `doctor` validates the configured local backend instead of only checking install state.
- vLLM, Ollama, and generic OpenAI-compatible gateways are all supported under the same terminal UX.
- Local models that need earlier summarization can be tuned with a compact-context cap during setup.

## Backend notes

- Internal `/v1/messages` payloads are translated into OpenAI-compatible `/v1/chat/completions` requests.
- vLLM is the default OpenAI-compatible target for source installs.
- Tool calls are mapped to function-calling so agent loops remain intact.
- Token counting is estimated locally.
- Text, tool, and image workflows are translated for OpenAI-compatible backends.

## Repository

Primary repository target: https://github.com/chromebookwiz/localClawd