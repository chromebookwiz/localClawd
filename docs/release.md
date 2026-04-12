# Release Operations

This repository is ready for a source-first `v1.0.0` GitHub release. The universal installers and source fallback path can ship from this checkout today. Native multi-platform binaries are still a separate follow-up because they depend on artifacts that are not produced by this public workspace alone.

## Source-first `v1.0.0` publish

1. Wait for `.github/workflows/ci.yml` to pass `audit:branding`, `bun run build`, and `verify:npm-install` on the commit you want to release. `verify:npm-install` now checks both the packed binary fast-path and an installed interactive startup smoke test when a TTY is available.
2. Verify the bootstrap installers and Bun-based source launcher from this checkout if you changed installer code.
3. Create and push the `v1.0.0` tag.
4. Publish GitHub release notes that describe the current distribution model as source-first, with native assets to follow.

### Current release cut status

- Branding and publish-surface verification are currently green from this checkout.
- `npm run lint` passes locally, covering build, branding audit, installed binary verification, and interactive startup verification.
- High-signal `Claude Code` / `Claude Desktop` source references have been removed from the live `src/**` tree. Remaining references are intentional compatibility surfaces, audit rules, or migration helpers.
- The working tree also contains a broader V2-to-non-V2 consolidation (`LogoV2`, `TaskListV2`, `useTasksV2`, `ExitPlanModeV2Tool`, `planModeV2`) that is mechanically consistent but larger than the minimal branding publish pass.
- One adjacent runtime change merits explicit review in any release PR: `src/services/api/client.ts` now falls back to `local-no-key-required` for local-provider SDK configuration.

### Suggested release PR framing

- Primary scope: rebrand publish-facing product copy, help text, permission prompts, attribution, onboarding, and desktop handoff language to `localclawd`.
- Secondary scope: finish the V2 suffix consolidation already in flight so the public tree no longer ships parallel legacy names.
- Reviewer callout: confirm the local-provider auth fallback in `src/services/api/client.ts` is intentional and covered by local-backend behavior.

## Native asset follow-up

The asset workflow remains available for a later native release once the missing generated/private build inputs are restored. `.github/workflows/publish-release-assets.yml` now re-runs the same branding, build, and npm-install verification checks before it publishes any assets.

## Expected release assets

- localclawd-win32-x64.exe
- localclawd-win32-arm64.exe
- localclawd-linux-x64
- localclawd-linux-arm64
- localclawd-darwin-x64
- localclawd-darwin-arm64

## Manifest format

The external native updater reads version pointers from `release-manifests/latest` and `release-manifests/stable`, then fetches `release-manifests/<version>/manifest.json`.

Each manifest entry must provide:

- `checksum`: SHA-256 of the asset
- `url`: direct download URL for the platform binary

## Native asset publishing flow

1. Produce the six platform binaries and place them in `release-assets/`.
2. Run `tools/release/generate-manifest.ps1` or `tools/release/generate-manifest.sh` to generate `release-manifests/<version>/manifest.json`.
3. Trigger `.github/workflows/publish-release-assets.yml` or push a `v*` tag.
4. Let the workflow re-run `audit:branding`, `bun run build`, and `verify:npm-install` before publishing.
5. Verify the GitHub Release contains the assets and the manifest commit lands on `main`.

## Current blockers for a native binary release

- The source tree still references generated or build-time files that are not present in this checkout.
- Some imports still target private or ant-only packages that cannot be built from this public workspace alone.