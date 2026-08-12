@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install-fresh-rigweda-monitor.ps1" %*
exit /b %errorlevel%
