param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('install', 'rebrand', 'audit-branding')]
    [string]$Command,

    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

switch ($Command) {
    'install' {
        & (Join-Path $PSScriptRoot 'install-localclawd.ps1') -RepoRoot $repoRoot
    }
    'rebrand' {
        & (Join-Path $PSScriptRoot 'rebrand-localclawd.ps1') -RepoRoot $repoRoot -DryRun:$DryRun
    }
    'audit-branding' {
        Push-Location $repoRoot
        try {
            & node .\scripts\audit-branding.mjs
        }
        finally {
            Pop-Location
        }
    }
}