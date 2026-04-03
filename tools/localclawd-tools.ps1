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
        $matches = Get-ChildItem -Path $repoRoot -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notmatch '\\.git\\|\\node_modules\\|\\dist\\|\\build\\|\\coverage\\' } |
            Select-String -Pattern 'Claude|claude' -AllMatches -ErrorAction SilentlyContinue
        if (-not $matches) {
            Write-Host 'No Claude/claude references found.'
            break
        }

        $grouped = $matches | Group-Object Path | Sort-Object Count -Descending
        foreach ($group in $grouped) {
            Write-Host ("{0}  {1}" -f $group.Count.ToString().PadLeft(4), $group.Name.Replace($repoRoot + [IO.Path]::DirectorySeparatorChar, ''))
        }

        Write-Host "Total matches: $($matches.Count)"
    }
}