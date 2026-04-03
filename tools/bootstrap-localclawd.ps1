param(
    [string]$Repository = 'chromebookwiz/localClawd',
    [string]$Branch = 'main',
    [string]$InstallRoot = (Join-Path $HOME '.localClawd\source')
)

$ErrorActionPreference = 'Stop'

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("localclawd-bootstrap-" + [Guid]::NewGuid().ToString('N'))
$zipPath = Join-Path $tempRoot 'localclawd.zip'
$extractRoot = Join-Path $tempRoot 'extract'
$downloadUrl = "https://github.com/$Repository/archive/refs/heads/$Branch.zip"

try {
    New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

    Write-Host "Downloading $Repository ($Branch)..."
    Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath

    Write-Host 'Extracting source bundle...'
    Expand-Archive -Path $zipPath -DestinationPath $extractRoot -Force

    $checkout = Get-ChildItem -Path $extractRoot -Directory | Select-Object -First 1
    if (-not $checkout) {
        throw 'Could not locate extracted localClawd source.'
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

    Write-Host 'Running localClawd installer...'
    & powershell -NoProfile -ExecutionPolicy Bypass -File $installer -RepoRoot $InstallRoot
}
finally {
    if (Test-Path $tempRoot) {
        Remove-Item -Path $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}