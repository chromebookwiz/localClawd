# localClawd

localClawd is a local-first fork of Claude Code focused on self-hosted inference. It preserves the terminal-first coding loop, tool orchestration, agents, and computer-use workflow, while replacing the hosted Claude dependency with user-controlled backends such as vLLM, Ollama, and OpenAI-compatible gateways.

## Overview

localClawd keeps the parts of Claude Code that were operationally strong and extends them for local deployment. The project is designed for users who want Claude Code-style workflows without depending on Anthropic-hosted inference.

### Key additions

- In-app backend setup for provider, endpoint, model, and optional API key during onboarding or later in `/config`.
- An OpenAI-compatible transport layer that maps internal Claude-style requests onto `/v1/chat/completions`.
- vLLM-first defaults, with Ollama and generic OpenAI-compatible endpoints supported as first-class backends.
- Backend diagnostics in `localClawd doctor`, including endpoint reachability, auth state, and last probe result.
- Compact-context controls for local models that degrade before their advertised context limit.
- Multimodal passthrough for local models that support image and screenshot input.

## Installation

The bootstrap installers use a release-first strategy. They attempt to install a platform-native binary from GitHub Releases and fall back to a source checkout when no matching release asset is available yet.

### Windows

One-line install in PowerShell:

```powershell
curl.exe -fsSL https://raw.githubusercontent.com/chromebookwiz/localClawd/main/tools/bootstrap-localclawd.ps1 | powershell -NoProfile -ExecutionPolicy Bypass -Command -
```

Do not use the Linux/macOS `bootstrap-localclawd.sh` command from PowerShell. PowerShell aliases `curl` to `Invoke-WebRequest`, so the Unix `curl -fsSL ... | bash` form will fail there.

PowerShell-native equivalent:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/chromebookwiz/localClawd/main/tools/bootstrap-localclawd.ps1').Content))"
```

From an existing checkout:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\install-localclawd.ps1
```

The Windows bootstrap installer first looks for a matching GitHub Release binary. If no release asset is available, it downloads the repository source bundle, bootstraps Bun with `winget` if needed, and creates a source-checkout launcher.

Default Windows paths:

- Native binary install: `%USERPROFILE%\.local\bin\localClawd.exe`
- Source fallback checkout: `%USERPROFILE%\.localClawd\source`
- Source fallback launcher: `%USERPROFILE%\.local\bin\localClawd.cmd`

### Linux

One-line install in a Unix shell such as `bash` or `zsh`:

```bash
curl -fsSL https://raw.githubusercontent.com/chromebookwiz/localClawd/main/tools/bootstrap-localclawd.sh | bash
```

This command is for Linux shells only. If you are on Windows PowerShell, use the Windows command above instead.

From an existing checkout:

```bash
bash ./tools/install-localclawd.sh
```

The Unix bootstrap installer first looks for a matching GitHub Release binary. If no release asset is available, it downloads the source bundle, installs Bun if needed, writes the source-checkout launcher to `~/.local/bin/localClawd`, and updates common shell startup files so that directory is on your `PATH`.

Default Linux paths:

- Native binary install: `~/.local/bin/localClawd`
- Source fallback checkout: `~/.localClawd/source`
- Source fallback launcher: `~/.local/bin/localClawd`

### macOS

One-line install in Terminal, iTerm, or another Unix shell:

```bash
curl -fsSL https://raw.githubusercontent.com/chromebookwiz/localClawd/main/tools/bootstrap-localclawd.sh | bash
```

This command is for macOS shells only. If you are on Windows PowerShell, use the Windows command above instead.

From an existing checkout:

```bash
bash ./tools/install-localclawd.sh
```

The macOS flow matches Linux: the bootstrap installer prefers a release binary and falls back to the source-checkout launcher when no release asset is available.

Default macOS paths:

- Native binary install: `~/.local/bin/localClawd`
- Source fallback checkout: `~/.localClawd/source`
- Source fallback launcher: `~/.local/bin/localClawd`

### Release asset naming

The bootstrap scripts expect release assets to follow the native installer platform naming already used in the codebase:

- `localClawd-win32-x64.exe`
- `localClawd-win32-arm64.exe`
- `localClawd-linux-x64`
- `localClawd-linux-arm64`
- `localClawd-darwin-x64`
- `localClawd-darwin-arm64`

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

## Release status

The repository contains source code and bootstrap installers, but it does not yet contain the complete release automation needed to publish and verify a full `1.0` native rollout from this checkout alone. The universal bootstrap path is ready to consume GitHub Release assets as soon as they are published. Until then, it falls back to the Bun-based source launcher.

External native update metadata is now expected under `release-manifests/`, and the asset publication workflow lives in `.github/workflows/publish-release-assets.yml`. See `docs/release.md` for the expected asset set and publish sequence.

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

- `tools\bootstrap-localclawd.ps1` installs a Windows release binary when one exists and otherwise falls back to the source-checkout installer.
- `tools/bootstrap-localclawd.sh` installs a Unix release binary when one exists and otherwise falls back to the source-checkout installer.
- `tools\install-localclawd.ps1` creates a Bun-based launcher for a checked-out repository on Windows.
- `tools/install-localclawd.sh` creates a Bun-based launcher for a checked-out repository on Unix-like systems.
- `tools\rebrand-localclawd.ps1` performs broad rebranding replacements across the repository.
- `tools\localclawd-tools.ps1` wraps install, rebrand, and branding audit operations in one PowerShell entrypoint.

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

1. Build and publish platform binaries named according to the release asset convention listed above.
2. Verify `localClawd install`, `localClawd update`, and `localClawd doctor` against those published artifacts.
3. Add release automation for tagging, asset publication, and post-publish verification.
4. Keep the legacy environment-variable aliases enabled until downstream wrappers and scripts have migrated.

## CLI install flow

The native install and update commands are exposed directly from the CLI for packaged builds:

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