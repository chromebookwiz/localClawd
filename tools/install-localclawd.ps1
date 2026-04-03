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

function Install-Bun {
    $bunInstallScriptUrl = 'https://bun.sh/install.ps1'

    try {
        Write-Host 'Bun was not found. Installing Bun with the official installer...'
        $installerScript = Invoke-RestMethod -Uri $bunInstallScriptUrl
        & ([scriptblock]::Create($installerScript))
        return
    }
    catch {
        Write-Host 'Official Bun installer failed. Trying winget fallback...'
    }

    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw 'Bun is required for localClawd source mode, and neither the official installer nor winget succeeded. Install Bun manually, then rerun this script.'
    }

    & winget install --id Oven-sh.Bun -e --silent --accept-package-agreements --accept-source-agreements
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
    Install-Bun
    Refresh-SessionPath
    $bunPath = Get-BunExecutable
    if (-not $bunPath) {
        throw 'Bun appears to be installed, but the executable could not be located. Open a new terminal and rerun this script.'
    }
}

$packageJson = Join-Path $RepoRoot 'package.json'
if (-not (Test-Path $packageJson)) {
    throw "Could not find package manifest at $packageJson"
}

$entrypoint = Join-Path $RepoRoot 'src\entrypoints\source-cli.ts'
if (-not (Test-Path $entrypoint)) {
    throw "Could not find CLI entrypoint at $entrypoint"
}

Write-Host 'Installing localClawd runtime dependencies with Bun...'
Push-Location $RepoRoot
try {
    & $bunPath install
}
finally {
    Pop-Location
}

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

$cmdPath = Join-Path $BinDir 'localClawd.cmd'
$ps1Path = Join-Path $BinDir 'localClawd.ps1'

$cmdContent = @"
@echo off
setlocal
if defined NODE_PATH (
    set "NODE_PATH=$RepoRoot;%NODE_PATH%"
) else (
    set "NODE_PATH=$RepoRoot"
)
if not defined USER_TYPE set "USER_TYPE=external"
"$bunPath" --install=auto --bun "$entrypoint" %*
endlocal
"@

$ps1Content = @"
`$ErrorActionPreference = 'Stop'
if (`$env:NODE_PATH) {
    `$env:NODE_PATH = "$RepoRoot;`$env:NODE_PATH"
} else {
    `$env:NODE_PATH = "$RepoRoot"
}
if (-not `$env:USER_TYPE) {
    `$env:USER_TYPE = 'external'
}
& "$bunPath" --install=auto --bun "$entrypoint" @args
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

$sessionPathEntries = @()
if ($env:Path) {
    $sessionPathEntries = $env:Path.Split(';', [System.StringSplitOptions]::RemoveEmptyEntries)
}

if ($sessionPathEntries -notcontains $BinDir) {
    $env:Path = "$BinDir;$env:Path"
}

Write-Host "Installed localClawd launcher at $cmdPath"
Write-Host "Added $BinDir to your user PATH if it was missing."
Write-Host "Installed Bun runtime: $bunPath"
Write-Host 'Installed project dependencies with bun install.'
Write-Host "Launcher runtime: $bunPath --install=auto --bun"
Write-Host 'Open a new terminal, then run: localClawd'