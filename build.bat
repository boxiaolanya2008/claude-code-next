@echo off
echo Building distributable package...

REM Create npm package
call npm pack

echo.
echo Package created: claude-code-next-2026.04.01.tgz
echo.
echo To install on any computer:
echo   npm install -g claude-code-next-2026.04.01.tgz
echo.
pause
