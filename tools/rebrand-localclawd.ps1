param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$skipDirectories = @('.git', 'node_modules', 'dist', 'build', 'coverage', '.next', 'out')
$skipExtensions = @(
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.tgz',
    '.7z', '.exe', '.dll', '.so', '.dylib', '.bin', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mp3'
)

$replacementTable = @(
    @{ From = 'localClawd'; To = 'localclawd' },
    @{ From = '.localClawd'; To = '.localclawd' },
    @{ From = 'Claude Code'; To = 'localclawd' },
    @{ From = 'Claude Desktop'; To = 'localclawd Desktop' },
    @{ From = 'Claude in Chrome'; To = 'localclawd in Chrome' },
    @{ From = 'Claude app'; To = 'localclawd app' }
)

function Test-TextFile {
    param([string]$Path)

    if ($skipExtensions -contains [IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        return $false
    }

    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -eq 0) {
        return $true
    }

    $sampleSize = [Math]::Min($bytes.Length, 4096)
    for ($index = 0; $index -lt $sampleSize; $index++) {
        if ($bytes[$index] -eq 0) {
            return $false
        }
    }

    return $true
}

$files = Get-ChildItem -Path $RepoRoot -Recurse -File | Where-Object {
    foreach ($segment in $_.FullName.Split([IO.Path]::DirectorySeparatorChar)) {
        if ($skipDirectories -contains $segment) {
            return $false
        }
    }
    return (Test-TextFile -Path $_.FullName)
}

$updated = 0

foreach ($file in $files) {
    $original = Get-Content -Path $file.FullName -Raw
    $rewritten = $original

    foreach ($pair in $replacementTable) {
        $rewritten = $rewritten.Replace($pair.From, $pair.To)
    }

    if ($rewritten -ne $original) {
        $updated++
        if (-not $DryRun) {
            Set-Content -Path $file.FullName -Value $rewritten -Encoding UTF8
        }
        $prefix = ''
        if ($DryRun) {
            $prefix = '[dry-run] '
        }
        $relativePath = $file.FullName.Replace($RepoRoot + [IO.Path]::DirectorySeparatorChar, '')
        Write-Host "$prefixupdated $relativePath"
    }
}

Write-Host "Processed $($files.Count) text files"
Write-Host "Updated $updated files"