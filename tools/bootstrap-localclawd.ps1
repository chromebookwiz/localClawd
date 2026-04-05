param(
    [string]$Repository = 'chromebookwiz/localclawd',
    [string]$Branch = 'main',
    [string]$InstallRoot = (Join-Path $HOME '.localclawd\source'),
    [string]$BinDir = (Join-Path $HOME '.local\bin'),
    [string]$Version,
    [ValidateSet('stable', 'latest')]
    [string]$Channel = 'latest',
    [string]$ReleaseDownloadBaseUrl = 'https://github.com',
    [switch]$NoSourceFallback
)

$ErrorActionPreference = 'Stop'

function Get-PlatformAssetName {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
    $normalizedArch = switch ($arch) {
        'x64' { 'x64' }
        'arm64' { 'arm64' }
        default { throw "Unsupported architecture for release install: $arch" }
    }

    return "localclawd-win32-$normalizedArch.exe"
}

function Ensure-BinDirOnPath {
    param([string]$TargetBinDir)

    New-Item -ItemType Directory -Force -Path $TargetBinDir | Out-Null

    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $pathEntries = @()
    if ($userPath) {
        $pathEntries = $userPath.Split(';', [System.StringSplitOptions]::RemoveEmptyEntries)
    }

    if ($pathEntries -notcontains $TargetBinDir) {
        $newUserPath = if ($userPath) { "$userPath;$TargetBinDir" } else { $TargetBinDir }
        [Environment]::SetEnvironmentVariable('Path', $newUserPath, 'User')
    }

    $sessionPathEntries = @()
    if ($env:Path) {
        $sessionPathEntries = $env:Path.Split(';', [System.StringSplitOptions]::RemoveEmptyEntries)
    }

    if ($sessionPathEntries -notcontains $TargetBinDir) {
        $env:Path = "$TargetBinDir;$env:Path"
    }
}

function Install-ReleaseAsset {
    param(
        [string]$TargetRepository,
        [string]$TargetVersion,
        [string]$TargetChannel,
        [string]$TargetBinDir,
        [string]$BaseUrl,
        [string]$WorkingRoot
    )

    $assetName = Get-PlatformAssetName
    $assetPath = Join-Path $WorkingRoot $assetName

    $candidateUrls = if ($TargetVersion) {
        @(
            "$BaseUrl/$TargetRepository/releases/download/v$TargetVersion/$assetName",
            "$BaseUrl/$TargetRepository/releases/download/$TargetVersion/$assetName"
        )
    }
    else {
        @("$BaseUrl/$TargetRepository/releases/latest/download/$assetName")
    }

    foreach ($candidateUrl in $candidateUrls) {
        try {
            Write-Host "Trying release asset: $candidateUrl"
            Invoke-WebRequest -Uri $candidateUrl -OutFile $assetPath

            Ensure-BinDirOnPath -TargetBinDir $TargetBinDir

            $installedBinary = Join-Path $TargetBinDir 'localclawd.exe'
            Move-Item -Path $assetPath -Destination $installedBinary -Force

            Write-Host "Installed localclawd release binary to $installedBinary"
            if ($TargetVersion) {
                Write-Host "Installed requested release version: $TargetVersion"
            }
            else {
                Write-Host "Installed release channel: $TargetChannel"
            }

            return $true
        }
        catch {
            Write-Host "Release asset unavailable at $candidateUrl"
        }
    }

    return $false
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("localclawd-bootstrap-" + [Guid]::NewGuid().ToString('N'))
$zipPath = Join-Path $tempRoot 'localclawd.zip'
$extractRoot = Join-Path $tempRoot 'extract'
$downloadUrl = "https://github.com/$Repository/archive/refs/heads/$Branch.zip"

try {
    New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

    if (Install-ReleaseAsset -TargetRepository $Repository -TargetVersion $Version -TargetChannel $Channel -TargetBinDir $BinDir -BaseUrl $ReleaseDownloadBaseUrl -WorkingRoot $tempRoot) {
        return
    }

    if ($NoSourceFallback) {
        throw 'No matching release asset was found and source fallback is disabled.'
    }

    Write-Host 'No release asset found. Falling back to source-checkout installation.'
    Write-Host "Downloading $Repository ($Branch)..."
    Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath

    Write-Host 'Extracting source bundle...'
    Expand-Archive -Path $zipPath -DestinationPath $extractRoot -Force

    $checkout = Get-ChildItem -Path $extractRoot -Directory | Select-Object -First 1
    if (-not $checkout) {
        throw 'Could not locate extracted localclawd source.'
    }

    if (Test-Path $InstallRoot) {
        Remove-Item -Path $InstallRoot -Recurse -Force
    }

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $InstallRoot) | Out-Null
    Move-Item -Path $checkout.FullName -Destination $InstallRoot

    $installer = Join-Path $InstallRoot 'tools\install-localclawd.ps1'
    if (-not (Test-Path $installer)) {
        throw "Installer script not found at $installer"
    }

    Write-Host 'Running localclawd installer...'
    & powershell -NoProfile -ExecutionPolicy Bypass -File $installer -RepoRoot $InstallRoot -BinDir $BinDir
}
finally {
    if (Test-Path $tempRoot) {
        Remove-Item -Path $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}