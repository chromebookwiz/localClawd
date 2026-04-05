$ErrorActionPreference = 'Stop'
if ($env:NODE_PATH) {
    $env:NODE_PATH = ".;$env:NODE_PATH"
} else {
    $env:NODE_PATH = "."
}
if (-not $env:USER_TYPE) {
    $env:USER_TYPE = 'external'
}
& "C:\Users\natha\AppData\Local\Microsoft\WinGet\Links\bun.exe" --install=auto --bun ".\src\entrypoints\source-cli.ts" @args
