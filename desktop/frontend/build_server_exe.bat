@echo off
setlocal

cd /d %~dp0

if not exist ".venv\Scripts\python.exe" (
  echo Virtual environment not found. Create desktop\frontend\.venv first.
  exit /b 1
)

set "APP_ENV=server"
set "RIGWEDA_MONITOR_DEFAULT_ENV=server"
set "SERVER_ENV_FILE=.env.server"
set "APP_NAME=RigwedaMonitor"
set "DIST_DIR=dist"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss_fff"') do set "BUILD_TOKEN=%%i"
set "BUILD_DIST_DIR=%TEMP%\RigwedaMonitorBuild-%BUILD_TOKEN%"
set "BUILD_WORK_DIR=%TEMP%\RigwedaMonitorWork-%BUILD_TOKEN%"
set "APP_DIST_DIR=%BUILD_DIST_DIR%\%APP_NAME%"
set "BUNDLE_NAME=%APP_NAME%FreshInstall"
set "BUNDLE_DIR=%DIST_DIR%\%BUNDLE_NAME%"
set "BUNDLE_ZIP=%DIST_DIR%\%BUNDLE_NAME%.zip"
set "BUNDLE_STAGE=%TEMP%\%BUNDLE_NAME%Stage"
set "INSTALL_SCRIPT_PS1=..\..\scripts\install-fresh-rigweda-monitor.ps1"
set "INSTALL_SCRIPT_BAT=..\..\scripts\install-fresh-rigweda-monitor.bat"
set "UNINSTALL_SCRIPT_PS1=..\..\scripts\uninstall-rigweda-monitor.ps1"
set "UNINSTALL_SCRIPT_BAT=..\..\scripts\uninstall-rigweda-monitor.bat"
set "STOP_PROCESSES_PS1=..\..\scripts\stop-rigweda-monitor-processes.ps1"

powershell -NoProfile -ExecutionPolicy Bypass -File "%STOP_PROCESSES_PS1%"
if not "%errorlevel%"=="0" exit /b %errorlevel%

if exist "build" rmdir /s /q "build"
mkdir "%DIST_DIR%" >nul 2>nul

if exist "%BUNDLE_DIR%" rmdir /s /q "%BUNDLE_DIR%"
if exist "%BUNDLE_ZIP%" del /q "%BUNDLE_ZIP%"
if exist "%BUNDLE_STAGE%" rmdir /s /q "%BUNDLE_STAGE%"

(
  echo HRMS_BACKEND_URL=https://rigweda-hrms-backend.onrender.com/api
  echo DESKTOP_BACKEND_URL=https://rigweda-monitor-backend.vercel.app/api
  echo DESKTOP_START_WINDOWS_SERVICE=false
  echo RIGWEDA_MONITOR_DATA_ROOT=%%LOCALAPPDATA%%\rigweda-monitor\data
  echo RIGWEDA_MONITOR_SCREENSHOT_ROOT=%%LOCALAPPDATA%%\rigweda-monitor\screenshots
  echo RIGWEDA_MONITOR_LOG_ROOT=%%LOCALAPPDATA%%\rigweda-monitor\logs
  echo RIGWEDA_MONITOR_SCAN_ROOTS=%%LOCALAPPDATA%%\rigweda-monitor\screenshots
  echo SCREENSHOT_INTERVAL_MS=30000
  echo SCREENSHOT_UPLOAD_BATCH_SIZE=30
  echo SCREENSHOT_UPLOAD_CONCURRENCY=4
  echo MOUSE_IDLE_THRESHOLD_SECONDS=60
  echo ACTIVITY_HEARTBEAT_SECONDS=30
) > "%SERVER_ENV_FILE%"

"%~dp0.venv\Scripts\python.exe" -m pip install -r requirements.txt
if not "%errorlevel%"=="0" exit /b %errorlevel%

".venv\Scripts\python.exe" -m PyInstaller --noconfirm --clean --distpath "%BUILD_DIST_DIR%" --workpath "%BUILD_WORK_DIR%" RigwedaMonitor.spec
set "BUILD_EXIT_CODE=%errorlevel%"
if "%BUILD_EXIT_CODE%"=="0" (
  copy /Y "%SERVER_ENV_FILE%" "%APP_DIST_DIR%\.env" >nul
  if not "%errorlevel%"=="0" exit /b %errorlevel%
  copy /Y "VERSION" "%APP_DIST_DIR%\VERSION" >nul
  if not "%errorlevel%"=="0" exit /b %errorlevel%
)
del "%SERVER_ENV_FILE%" >nul 2>nul
if not "%BUILD_EXIT_CODE%"=="0" exit /b %BUILD_EXIT_CODE%

mkdir "%BUNDLE_STAGE%" >nul 2>nul
mkdir "%BUNDLE_STAGE%\%APP_NAME%" >nul 2>nul
robocopy "%APP_DIST_DIR%" "%BUNDLE_STAGE%\%APP_NAME%" /E /NFL /NDL /NJH /NJS /NP >nul
set "ROBOCOPY_BUNDLE_EXIT=%errorlevel%"
if %ROBOCOPY_BUNDLE_EXIT% GEQ 8 exit /b %ROBOCOPY_BUNDLE_EXIT%
copy /Y "%INSTALL_SCRIPT_PS1%" "%BUNDLE_STAGE%\" >nul
copy /Y "%INSTALL_SCRIPT_BAT%" "%BUNDLE_STAGE%\" >nul
copy /Y "%UNINSTALL_SCRIPT_PS1%" "%BUNDLE_STAGE%\" >nul
copy /Y "%UNINSTALL_SCRIPT_BAT%" "%BUNDLE_STAGE%\" >nul
if not "%errorlevel%"=="0" exit /b %errorlevel%
if exist "%BUNDLE_DIR%" rmdir /s /q "%BUNDLE_DIR%"
robocopy "%BUNDLE_STAGE%" "%BUNDLE_DIR%" /E /NFL /NDL /NJH /NJS /NP >nul
set "ROBOCOPY_BUNDLE_DIR_EXIT=%errorlevel%"
if %ROBOCOPY_BUNDLE_DIR_EXIT% GEQ 8 exit /b %ROBOCOPY_BUNDLE_DIR_EXIT%
powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '%BUNDLE_STAGE%\*' -DestinationPath '%BUNDLE_ZIP%' -Force"
if not "%errorlevel%"=="0" exit /b %errorlevel%

rmdir /s /q "%BUNDLE_STAGE%"
if exist "%APP_DIST_DIR%" rmdir /s /q "%APP_DIST_DIR%"

echo.
echo Build complete.
echo Fresh install folder: %BUNDLE_DIR%
echo Fresh install zip: %BUNDLE_ZIP%
echo Run installer: %BUNDLE_DIR%\install-fresh-rigweda-monitor.bat
echo Run uninstaller: %BUNDLE_DIR%\uninstall-rigweda-monitor.bat
echo Or run app directly: %BUNDLE_DIR%\%APP_NAME%\RigwedaMonitor.exe
