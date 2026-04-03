param(
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [Parameter(Mandatory = $true)]
    [string]$AssetsDir,
    [Parameter(Mandatory = $true)]
    [string]$OutputDir,
    [string]$Repository = 'chromebookwiz/localClawd',
    [string]$ReleaseDownloadBaseUrl = 'https://github.com',
    [ValidateSet('stable', 'latest')]
    [string[]]$Channels = @('latest', 'stable')
)

$ErrorActionPreference = 'Stop'

$platformMap = @{
    'win32-x64'   = 'localClawd-win32-x64.exe'
    'win32-arm64' = 'localClawd-win32-arm64.exe'
    'linux-x64'   = 'localClawd-linux-x64'
    'linux-arm64' = 'localClawd-linux-arm64'
    'darwin-x64'  = 'localClawd-darwin-x64'
    'darwin-arm64' = 'localClawd-darwin-arm64'
}

$versionDir = Join-Path $OutputDir $Version
New-Item -ItemType Directory -Force -Path $versionDir | Out-Null

$platforms = @{}
foreach ($platform in $platformMap.Keys) {
    $assetName = $platformMap[$platform]
    $assetPath = Join-Path $AssetsDir $assetName
    if (-not (Test-Path $assetPath)) {
        throw "Missing release asset: $assetName"
    }

    $hash = (Get-FileHash -Path $assetPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $platforms[$platform] = @{
        checksum = $hash
        url = "$ReleaseDownloadBaseUrl/$Repository/releases/download/v$Version/$assetName"
    }
}

$manifest = @{
    version = $Version
    generatedAt = [DateTime]::UtcNow.ToString('o')
    platforms = $platforms
}

$manifestPath = Join-Path $versionDir 'manifest.json'
$manifest | ConvertTo-Json -Depth 6 | Set-Content -Path $manifestPath -Encoding UTF8

foreach ($channel in $Channels) {
    Set-Content -Path (Join-Path $OutputDir $channel) -Value $Version -Encoding ASCII
}

Write-Host "Generated manifest at $manifestPath"