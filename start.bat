@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
if exist ".env" (
    C:\Users\Administrator\.bun\bin\bun.exe --env-file=.env src\entrypoints\cli.tsx %*
) else (
    C:\Users\Administrator\.bun\bin\bun.exe src\entrypoints\cli.tsx %*
)
