@echo off
setlocal

REM Remove the elevated interactive startup task created by Rigweda Monitor.

schtasks /Delete /TN RigwedaMonitor /F
if not "%ERRORLEVEL%"=="0" exit /b %ERRORLEVEL%

endlocal
