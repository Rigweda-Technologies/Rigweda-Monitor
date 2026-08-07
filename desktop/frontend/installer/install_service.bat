@echo off
setlocal

REM Install and start the MyApp backend Windows Service.
REM Run this from an elevated Command Prompt.

set "SERVICE_SCRIPT=%~dp0..\services\background_service.py"
set "REQUIREMENTS=%~dp0..\requirements.txt"

net session >nul 2>&1
if not "%ERRORLEVEL%"=="0" (
    echo This installer must be run as Administrator.
    echo Right-click Command Prompt and choose "Run as administrator", then run this file again.
    exit /b 1
)

python -m pip install --upgrade --force-reinstall --no-user -r "%REQUIREMENTS%"
if not "%ERRORLEVEL%"=="0" exit /b %ERRORLEVEL%

python "%~dp0run_pywin32_postinstall.py"
if not "%ERRORLEVEL%"=="0" exit /b %ERRORLEVEL%

python "%SERVICE_SCRIPT%" stop
python "%SERVICE_SCRIPT%" remove
python "%SERVICE_SCRIPT%" install
if not "%ERRORLEVEL%"=="0" exit /b %ERRORLEVEL%

python "%SERVICE_SCRIPT%" start
if not "%ERRORLEVEL%"=="0" exit /b %ERRORLEVEL%

endlocal
