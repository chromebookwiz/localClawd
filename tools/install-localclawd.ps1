param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
    [string]$BinDir = (Join-Path $HOME '.local\bin')
)

$ErrorActionPreference = 'Stop'

function Get-BunExecutable {
    $command = Get-Command bun -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $commonPaths = @(
        (Join-Path $HOME '.bun\bin\bun.exe'),
        (Join-Path $env:LOCALAPPDATA 'bun\bin\bun.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Bun\bun.exe'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\bun.exe')
    )

    foreach ($candidate in $commonPaths) {
        if ($candidate -and (Test-Path $candidate)) {
            return $candidate
        }
    }

    return $null
}

function Refresh-SessionPath {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $segments = @($machinePath, $userPath) | Where-Object { $_ }
    if ($segments.Count -gt 0) {
        $env:Path = ($segments -join ';')
    }
}

$bunPath = Get-BunExecutable
if (-not $bunPath) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw 'Bun is required for this source-checkout installer, and winget is not available to install it automatically. Install Bun first, then rerun this script.'
    }

    Write-Host 'Bun was not found. Installing Bun with winget...'
    & winget install --id Oven-sh.Bun -e --silent --accept-package-agreements --accept-source-agreements

    Refresh-SessionPath
    $bunPath = Get-BunExecutable
    if (-not $bunPath) {
        throw 'Bun appears to be installed, but the executable could not be located. Open a new terminal and rerun this script.'
    }
}

$entrypoint = Join-Path $RepoRoot 'src\entrypoints\source-cli.ts'
if (-not (Test-Path $entrypoint)) {
    throw "Could not find CLI entrypoint at $entrypoint"
}

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

$cmdPath = Join-Path $BinDir 'localClawd.cmd'
$ps1Path = Join-Path $BinDir 'localClawd.ps1'

$cmdContent = @"
@echo off
setlocal
"$bunPath" --bun "$entrypoint" %*
endlocal
"@

$ps1Content = @"
`$ErrorActionPreference = 'Stop'
& "$bunPath" --bun "$entrypoint" @args
"@

Set-Content -Path $cmdPath -Value $cmdContent -Encoding ASCII
Set-Content -Path $ps1Path -Value $ps1Content -Encoding ASCII

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$pathEntries = @()
if ($userPath) {
    $pathEntries = $userPath.Split(';', [System.StringSplitOptions]::RemoveEmptyEntries)
}

if ($pathEntries -notcontains $BinDir) {
    $newUserPath = if ($userPath) { "$userPath;$BinDir" } else { $BinDir }
    [Environment]::SetEnvironmentVariable('Path', $newUserPath, 'User')
}

if (($env:Path.Split(';', [System.StringSplitOptions]::RemoveEmptyEntries)) -notcontains $BinDir) {
    $env:Path = "$BinDir;$env:Path"
}

Write-Host "Installed localClawd launcher at $cmdPath"
Write-Host "Added $BinDir to your user PATH if it was missing."
Write-Host "Launcher runtime: $bunPath --bun"
Write-Host 'Open a new terminal, then run: localClawd --help'