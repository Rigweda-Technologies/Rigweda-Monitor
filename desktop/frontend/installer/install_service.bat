@echo off
setlocal

REM Install and start the MyApp backend Windows Service.
REM Run this from an elevated Command Prompt.

set "SERVICE_SCRIPT=%~dp0..\services\background_service.py"
set "REQUIREMENTS=%~dp0..\requirements.txt"
set "VENV_DIR=%~dp0..\.venv"
set "PYTHON_EXE=%VENV_DIR%\Scripts\python.exe"

net session >nul 2>&1
if not "%ERRORLEVEL%"=="0" (
    echo This installer must be run as Administrator.
    echo Right-click Command Prompt and choose "Run as administrator", then run this file again.
    exit /b 1
)

if not exist "%PYTHON_EXE%" (
    python -m venv "%VENV_DIR%"
    if not "%ERRORLEVEL%"=="0" exit /b %ERRORLEVEL%
)

"%PYTHON_EXE%" -m pip install --upgrade --force-reinstall -r "%REQUIREMENTS%"
if not "%ERRORLEVEL%"=="0" exit /b %ERRORLEVEL%

"%PYTHON_EXE%" "%~dp0run_pywin32_postinstall.py"
if not "%ERRORLEVEL%"=="0" exit /b %ERRORLEVEL%

"%PYTHON_EXE%" "%SERVICE_SCRIPT%" stop
"%PYTHON_EXE%" "%SERVICE_SCRIPT%" remove
"%PYTHON_EXE%" "%SERVICE_SCRIPT%" install
if not "%ERRORLEVEL%"=="0" exit /b %ERRORLEVEL%

"%PYTHON_EXE%" "%SERVICE_SCRIPT%" start
if not "%ERRORLEVEL%"=="0" exit /b %ERRORLEVEL%

endlocal
