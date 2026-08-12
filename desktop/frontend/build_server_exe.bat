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
set "APP_DIST_DIR=%DIST_DIR%\%APP_NAME%"
set "APP_ZIP=%DIST_DIR%\%APP_NAME%.zip"
set "SHARE_DIR=%DIST_DIR%\%APP_NAME%Share"
set "SHARE_ZIP=%DIST_DIR%\%APP_NAME%Share.zip"
set "INSTALL_SCRIPT_PS1=..\..\scripts\install-fresh-rigweda-monitor.ps1"
set "INSTALL_SCRIPT_BAT=..\..\scripts\install-fresh-rigweda-monitor.bat"

if exist "%APP_DIST_DIR%" rmdir /s /q "%APP_DIST_DIR%"
if exist "%APP_ZIP%" del /q "%APP_ZIP%"
if exist "%DIST_DIR%\%APP_NAME%.exe" del /q "%DIST_DIR%\%APP_NAME%.exe"
if exist "%DIST_DIR%\RigwedaMonitor-folder-build.zip" del /q "%DIST_DIR%\RigwedaMonitor-folder-build.zip"
if exist "%DIST_DIR%\RigwedaMonitorFolder" rmdir /s /q "%DIST_DIR%\RigwedaMonitorFolder"
if exist "%DIST_DIR%\RigwedaMonitorDebug" rmdir /s /q "%DIST_DIR%\RigwedaMonitorDebug"
if exist "%SHARE_DIR%" rmdir /s /q "%SHARE_DIR%"
if exist "%SHARE_ZIP%" del /q "%SHARE_ZIP%"

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

".venv\Scripts\python.exe" -m PyInstaller --noconfirm --clean RigwedaMonitor.spec
set "BUILD_EXIT_CODE=%errorlevel%"
del "%SERVER_ENV_FILE%" >nul 2>nul
if not "%BUILD_EXIT_CODE%"=="0" exit /b %BUILD_EXIT_CODE%

powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '%APP_DIST_DIR%' -DestinationPath '%APP_ZIP%' -Force"
if not "%errorlevel%"=="0" exit /b %errorlevel%

mkdir "%SHARE_DIR%" >nul 2>nul
if exist "%SHARE_DIR%" rmdir /s /q "%SHARE_DIR%"
mkdir "%SHARE_DIR%"
xcopy "%APP_DIST_DIR%" "%SHARE_DIR%\%APP_NAME%\" /E /I /H /Y >nul
copy /Y "%INSTALL_SCRIPT_PS1%" "%SHARE_DIR%\" >nul
copy /Y "%INSTALL_SCRIPT_BAT%" "%SHARE_DIR%\" >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '%SHARE_DIR%' -DestinationPath '%SHARE_ZIP%' -Force"
if not "%errorlevel%"=="0" exit /b %errorlevel%

echo.
echo Build complete.
echo Copy this ZIP to another laptop: %APP_ZIP%
echo Or copy this whole folder: %APP_DIST_DIR%
echo Shared install folder: %SHARE_DIR%
echo Shared install ZIP: %SHARE_ZIP%
echo Run installer: %SHARE_DIR%\install-fresh-rigweda-monitor.bat
echo Or run app directly: %SHARE_DIR%\%APP_NAME%\RigwedaMonitor.exe
