@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "UPDATE_SCRIPT=%SCRIPT_DIR%update.ps1"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$updateScript = '%UPDATE_SCRIPT%';" ^
  "$value = 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File ""' + $updateScript + '""';" ^
  "Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'RigwedaMonitorUpdate' -Value $value"

endlocal
