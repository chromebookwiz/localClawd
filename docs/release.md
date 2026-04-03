# Release Operations

This repository can now publish release metadata and GitHub Release assets for the universal installers, but it still assumes the platform binaries are produced outside this checkout.

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

## Publishing flow

1. Produce the six platform binaries and place them in `release-assets/`.
2. Run `tools/release/generate-manifest.ps1` or `tools/release/generate-manifest.sh` to generate `release-manifests/<version>/manifest.json`.
3. Trigger `.github/workflows/publish-release-assets.yml` or push a `v*` tag.
4. Verify the GitHub Release contains the assets and the manifest commit lands on `main`.

## Current blockers for a true 1.0 release

- The repo still has no full dependency manifest or lockfile.
- The source tree still references generated or build-time files that are not present in this checkout.
- Some imports still target private or ant-only packages that cannot be built from this public workspace alone.