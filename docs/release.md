# Release Operations

This repository is ready for a source-first `v1.0.0` GitHub release. The universal installers and source fallback path can ship from this checkout today. Native multi-platform binaries are still a separate follow-up because they depend on artifacts that are not produced by this public workspace alone.

## Source-first `v1.0.0` publish

1. Verify the bootstrap installers and Bun-based source launcher from this checkout.
2. Create and push the `v1.0.0` tag.
3. Publish GitHub release notes that describe the current distribution model as source-first, with native assets to follow.

## Native asset follow-up

The asset workflow remains available for a later native release once the missing generated/private build inputs are restored.

## Expected release assets

- localClawd-win32-x64.exe
- localClawd-win32-arm64.exe
- localClawd-linux-x64
- localClawd-linux-arm64
- localClawd-darwin-x64
- localClawd-darwin-arm64

## Manifest format

The external native updater reads version pointers from `release-manifests/latest` and `release-manifests/stable`, then fetches `release-manifests/<version>/manifest.json`.

Each manifest entry must provide:

- `checksum`: SHA-256 of the asset
- `url`: direct download URL for the platform binary

## Native asset publishing flow

1. Produce the six platform binaries and place them in `release-assets/`.
2. Run `tools/release/generate-manifest.ps1` or `tools/release/generate-manifest.sh` to generate `release-manifests/<version>/manifest.json`.
3. Trigger `.github/workflows/publish-release-assets.yml` or push a `v*` tag.
4. Verify the GitHub Release contains the assets and the manifest commit lands on `main`.

## Current blockers for a native binary release

- The source tree still references generated or build-time files that are not present in this checkout.
- Some imports still target private or ant-only packages that cannot be built from this public workspace alone.