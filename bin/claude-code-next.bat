@echo off
setlocal

REM Claude Code Next - Global launcher
REM Change to project directory so .env and relative paths work
cd /d "%~dp0.."

REM Default: full CLI with Ink TUI
bun --env-file=.env ./src/entrypoints/cli.tsx %*

endlocal
