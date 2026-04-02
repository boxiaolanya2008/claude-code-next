@echo off
setlocal

REM Claude Code Next - Global launcher
REM Save original directory (user's working directory)
set "ORIGINAL_CWD=%CD%"

REM Get project directory
set "PROJECT_DIR=%~dp0.."
set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

REM Pass original cwd via environment variable
set "CLAUDE_CODE_ORIGINAL_CWD=%ORIGINAL_CWD%"

REM Change to original directory before executing
cd /d "%ORIGINAL_CWD%"

REM Default: full CLI with Ink TUI
if exist "%PROJECT_DIR%\.env" (
    bun --preload="%PROJECT_DIR%\preload.ts" --env-file="%PROJECT_DIR%\.env" "%PROJECT_DIR%\src\entrypoints\cli.tsx" %*
) else (
    bun --preload="%PROJECT_DIR%\preload.ts" "%PROJECT_DIR%\src\entrypoints\cli.tsx" %*
)

endlocal
