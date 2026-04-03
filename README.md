# localClawd

localClawd is a local-first coding CLI derived from the original codebase and retargeted to user-controlled backends such as NVIDIA Spark and Ollama. The goal is to preserve the terminal UX, tool loop, agents, and computer-use workflows while removing hosted-product assumptions.

## What changed

- The CLI name, onboarding, prompts, and built-in agents are reworked for localClawd.
- Anthropic-style internal requests are translated to OpenAI-compatible chat completion calls for local inference servers.
- Vision-capable local models can receive pasted images and browser/computer-use screenshots.
- The installer, updater, and native binary now use the localClawd name.
- Setup now lets you choose a compact context window cap for local models that need earlier summarization.

## Quick start

By default, localClawd targets an NVIDIA Spark OpenAI-compatible endpoint. Switch to Ollama explicitly when you want a fully local daemon.

One-command Windows install from this checkout:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\install-localclawd.ps1
```

The installer bootstraps Bun with `winget` if it is not already installed, then adds a `localClawd` launcher to your user PATH.

localClawd accepts native environment variable names. Legacy `CLAUDE_CODE_*` names are still accepted as compatibility aliases, but new setups should prefer `LOCALCLAWD_*`.

For NVIDIA Spark:

```powershell
$env:NVIDIA_API_KEY = 'your-nvidia-key'
$env:LOCALCLAWD_USE_SPARK = '1'
$env:LOCALCLAWD_LOCAL_BASE_URL = 'https://integrate.api.nvidia.com/v1'
$env:LOCALCLAWD_LOCAL_MODEL = 'Qwen/Qwen2.5-Coder-32B-Instruct'
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
2. Run a locally built `localClawd` executable from your own development workflow, then use the native installer command below to place it in your user bin directory.

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
- `tools\rebrand-localclawd.ps1` aggressively rewrites `Claude` and `claude` occurrences across the repo to `localClawd`.
- `tools\localclawd-tools.ps1` wraps install, rebrand, and branding audit in a single entrypoint.

### Backend environment variables

localClawd currently recognizes both native and legacy variable names for the local backend configuration. Prefer the native names below for new setups:

- `LOCALCLAWD_USE_SPARK`
- `LOCALCLAWD_USE_OLLAMA`
- `LOCALCLAWD_LOCAL_BASE_URL`
- `LOCALCLAWD_LOCAL_MODEL`
- `LOCALCLAWD_LOCAL_API_KEY`
- `NVIDIA_API_KEY`
- `NVAPI_KEY`
- `LOCALCLAWD_AUTO_COMPACT_WINDOW`

Legacy compatibility aliases that still work:

- `LOCALCLAWD_USE_VLLM` and `CLAUDE_CODE_USE_VLLM` are treated as Spark aliases.
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

## Backend notes

- Internal `/v1/messages` payloads are translated into OpenAI-compatible `/v1/chat/completions` requests.
- NVIDIA Spark is the default OpenAI-compatible target for source installs.
- Tool calls are mapped to function-calling so agent loops remain intact.
- Token counting is estimated locally.
- Text, tool, and image workflows are translated for OpenAI-compatible backends.

## Repository

Primary repository target: https://github.com/chromebookwiz/localClawd