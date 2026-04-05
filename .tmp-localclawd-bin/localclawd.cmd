@echo off
setlocal
if defined NODE_PATH (
    set "NODE_PATH=.;%NODE_PATH%"
) else (
    set "NODE_PATH=."
)
if not defined USER_TYPE set "USER_TYPE=external"
"C:\Users\natha\AppData\Local\Microsoft\WinGet\Links\bun.exe" --install=auto --bun ".\src\entrypoints\source-cli.ts" %*
endlocal
