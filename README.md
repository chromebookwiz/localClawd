# localclawd

localclawd is a local-first fork of the upstream hosted coding CLI focused on self-hosted inference. It preserves the terminal-first coding loop, tool orchestration, agents, and computer-use workflow, while replacing the hosted model dependency with user-controlled backends such as vLLM, Ollama, and OpenAI-compatible gateways.

## Overview

localclawd keeps the parts of the upstream CLI that were operationally strong and extends them for local deployment. The project is designed for users who want the same terminal-first workflow without depending on hosted Anthropic inference.

### Key additions

- In-app backend setup for provider, endpoint, model, and optional API key during onboarding or later in `/config`.
- An OpenAI-compatible transport layer that maps internal assistant requests onto `/v1/chat/completions`.
- vLLM-first defaults, with Ollama and generic OpenAI-compatible endpoints supported as first-class backends.
- Backend diagnostics in `localclawd doctor`, including endpoint reachability, auth state, and last probe result.
- Compact-context controls for local models that degrade before their advertised context limit.
- Multimodal passthrough for local models that support image and screenshot input.
- **Lattice memory scoring** — memory files tagged with `tags:` frontmatter are ranked using Jaccard similarity and co-occurrence lattice math. Works offline as a fallback when a hosted side-query model is unavailable.
- **`/keepgoing`** — autonomous task continuation loop. The model works through all outstanding steps without waiting for user input and re-queues itself after each response. Stops when the model emits `TASK COMPLETE:` or `NEEDS INPUT:`. Aliases: `/kg`, `/continue`.
- **`/buddy`** — spawns a named ASCII animal companion for the session with a personality. Use `/buddy pet` to hear their thoughts on the current codebase.
- **`/thinkharder`** — enables careful mode: the model double-checks its reasoning at each step, verifies assumptions by reading files, and queries memory more frequently. Use `/thinknormal` to return to the default pipeline.
- **`/thinknormal`** — resets to the default pipeline. Lattice memory is fallback-only, as designed. Alias: `/tn`.

## Installation

The bootstrap installers use a release-first strategy. They attempt to install a platform-native binary from GitHub Releases and fall back to a source checkout when no matching release asset is available yet.

### npm

Global install:

```bash
npm install -g localclawd
```

Run without installing globally:

```bash
npx localclawd --version
```

The npm package name is lowercase: `localclawd`. Any mixed-case install attempt will fail because npm package names cannot contain capital letters. The published CLI command is also `localclawd`.

### Windows

One-line install in PowerShell:

```powershell
irm https://raw.githubusercontent.com/chromebookwiz/localclawd/main/tools/bootstrap-localclawd.ps1 | iex
```

This is the primary Windows install command. It installs Bun automatically when needed, runs `bun install` for the source fallback checkout, and then adds the `localclawd` launcher to your user path.

Do not use the Linux/macOS `bootstrap-localclawd.sh` command from PowerShell. PowerShell aliases `curl` to `Invoke-WebRequest`, so the Unix `curl -fsSL ... | bash` form will fail there.

PowerShell-native equivalent:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/chromebookwiz/localclawd/main/tools/bootstrap-localclawd.ps1').Content))"
```

From an existing checkout:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\install-localclawd.ps1
```

The Windows bootstrap installer first looks for a matching GitHub Release binary. If no release asset is available, it downloads the repository source bundle, installs Bun automatically if needed, runs `bun install`, and creates a source-checkout launcher.

Default Windows paths:

- Native binary install: `%USERPROFILE%\.local\bin\localclawd.exe`
- Source fallback checkout: `%USERPROFILE%\.localclawd\source`
- Source fallback launcher: `%USERPROFILE%\.local\bin\localclawd.cmd`

### Linux

One-line install in a Unix shell such as `bash` or `zsh`:

```bash
curl -fsSL https://raw.githubusercontent.com/chromebookwiz/localclawd/main/tools/bootstrap-localclawd.sh | bash
```

This command is for Linux shells only. If you are on Windows PowerShell, use the Windows command above instead.

From an existing checkout:

```bash
bash ./tools/install-localclawd.sh
```

The Unix bootstrap installer first looks for a matching GitHub Release binary. If no release asset is available, it downloads the source bundle, installs Bun if needed, writes the source-checkout launcher to `~/.local/bin/localclawd`, and updates common shell startup files so that directory is on your `PATH`.

Default Linux paths:

- Native binary install: `~/.local/bin/localclawd`
- Source fallback checkout: `~/.localclawd/source`
- Source fallback launcher: `~/.local/bin/localclawd`

### macOS

One-line install in Terminal, iTerm, or another Unix shell:

```bash
curl -fsSL https://raw.githubusercontent.com/chromebookwiz/localclawd/main/tools/bootstrap-localclawd.sh | bash
```

This command is for macOS shells only. If you are on Windows PowerShell, use the Windows command above instead.

From an existing checkout:

```bash
bash ./tools/install-localclawd.sh
```

The macOS flow matches Linux: the bootstrap installer prefers a release binary and falls back to the source-checkout launcher when no release asset is available.

Default macOS paths:

- Native binary install: `~/.local/bin/localclawd`
- Source fallback checkout: `~/.localclawd/source`
- Source fallback launcher: `~/.local/bin/localclawd`

### Release asset naming

The bootstrap scripts expect release assets to follow the native installer platform naming already used in the codebase:

- `localclawd-win32-x64.exe`
- `localclawd-win32-arm64.exe`
- `localclawd-linux-x64`
- `localclawd-linux-arm64`
- `localclawd-darwin-x64`
- `localclawd-darwin-arm64`

### Backend setup after install

localclawd accepts native environment variable names. Legacy `CLAUDE_CODE_*` names are still accepted as compatibility aliases, but new setups should prefer `LOCALCLAWD_*`.

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
localclawd
```

## Release status

`v1.0.5` is live on npm. Install globally with `npm install -g localclawd` or run without installing with `npx localclawd`. Native multi-platform binaries can be added later without changing the install surface.

**Changelog**
- `1.0.5` — Geometric algebra lattice (Cl(n,0) multivectors, FCA concept lattice, rotor temporal decay, IDF attention); /keepgoing upgraded to ultimate persistent mode with subagent support, 7 stop-signal patterns, unlimited rounds, round counter; /thinkharder enforces 4-phase DRAFT→CRITIQUE→REFINE→VERIFY pipeline per change.
- `1.0.4` — Fix `util is not defined` crash permanently by externalizing zod from the Bun bundle; add `/buddy`, `/thinkharder`, `/thinknormal` commands; fix `/keepgoing` autonomous loop; indigo/violet color scheme finalized.
- `1.0.3` — Fix `util3 is not defined` crash from zod v4 bundled inside `@modelcontextprotocol/sdk`; pin all deps to current versions; zod v3 forced globally via overrides+resolutions.
- `1.0.2` — Fix zod v4 bundler crash (`_uppercase2 is not defined`); pin zod to `^3`; version string now reflects package.json correctly.
- `1.0.1` — Fix npm bin entry; add `/keepgoing` command; lattice memory scoring; branding cleanup.
- `1.0.0` — Initial source-first release.

External native update metadata is now expected under `release-manifests/`, the main verification workflow lives in `.github/workflows/ci.yml`, and the native asset publication workflow lives in `.github/workflows/publish-release-assets.yml`. See `docs/release.md` for the expected asset set and publish sequence.

### Native install

If you already have a runnable `localclawd` executable, install it natively with:

```powershell
localclawd install
```

That installs the stable launcher to:

- Unix-like systems: `~/.local/bin/localclawd`
- Windows: `%USERPROFILE%\.local\bin\localclawd.exe`

After installation, verify the CLI is on your path:

```powershell
localclawd --version
localclawd doctor
```

To update an existing native install:

```powershell
localclawd update
```

### Power tools

- `tools\bootstrap-localclawd.ps1` installs a Windows release binary when one exists and otherwise falls back to the source-checkout installer.
- `tools/bootstrap-localclawd.sh` installs a Unix release binary when one exists and otherwise falls back to the source-checkout installer.
- `tools\install-localclawd.ps1` creates a Bun-based launcher for a checked-out repository on Windows.
- `tools/install-localclawd.sh` creates a Bun-based launcher for a checked-out repository on Unix-like systems.
- `tools\rebrand-localclawd.ps1` performs broad rebranding replacements across the repository.
- `tools\localclawd-tools.ps1` wraps install, rebrand, and branding audit operations in one PowerShell entrypoint.

### Backend environment variables

localclawd currently recognizes both native and legacy variable names for the local backend configuration. Prefer the native names below for new setups:

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
2. Verify `localclawd install`, `localclawd update`, and `localclawd doctor` against those published artifacts.
3. Keep `.github/workflows/ci.yml` green for `audit:branding`, `bun run build`, and `verify:npm-install` before tagging.
4. Use `.github/workflows/publish-release-assets.yml` to publish native assets and manifests after the verification workflow is green.
5. Keep the legacy environment-variable aliases enabled until downstream wrappers and scripts have migrated.

## CLI install flow

The native install and update commands are exposed directly from the CLI for packaged builds:

```powershell
localclawd install
localclawd update
localclawd doctor
```

The native installer places the executable at `~/.local/bin/localclawd` on Unix-like systems and `%USERPROFILE%\.local\bin\localclawd.exe` on Windows.

## Compact context window

During first-run setup, localclawd asks for a compact context window cap. Use this when your local model becomes unstable before its advertised maximum context size. You can change it later in `/config` under `Compact context window`.

## Why use it instead of the upstream hosted CLI

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

Primary repository target: https://github.com/chromebookwiz/localclawd