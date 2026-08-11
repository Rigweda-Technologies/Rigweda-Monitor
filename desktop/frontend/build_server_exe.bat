@echo off
setlocal

cd /d %~dp0

if not exist ".venv\Scripts\python.exe" (
  echo Virtual environment not found. Create desktop\frontend\.venv first.
  exit /b 1
)

set "APP_ENV=server"
set "RIGWEDA_MONITOR_DEFAULT_ENV=server"

".venv\Scripts\python.exe" -m PyInstaller --noconfirm --clean RigwedaMonitor.spec
if errorlevel 1 exit /b %errorlevel%

echo.
echo Build complete. The executable is in dist\RigwedaMonitor.exe
