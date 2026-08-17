@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
echo Clearing all Rigweda Monitor app data, tokens, logs, and install files...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install-fresh-rigweda-monitor.ps1" %*
exit /b %errorlevel%
