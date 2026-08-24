@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "UPDATE_SCRIPT=%SCRIPT_DIR%update.ps1"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""%UPDATE_SCRIPT%""';" ^
  "$trigger1 = New-ScheduledTaskTrigger -AtStartup;" ^
  "$trigger2 = New-ScheduledTaskTrigger -Daily -At 00:00;" ^
  "$trigger2.Repetition.Interval = '04:00:00';" ^
  "$trigger2.Repetition.Duration = 'P1D';" ^
  "$settings = New-ScheduledTaskSettingsSet -RunOnlyIfNetworkAvailable -StartWhenAvailable -AllowStartIfOnBatteries -Hidden;" ^
  "Register-ScheduledTask -TaskName 'RigwedaMonitorUpdate' -Action $action -Trigger $trigger1,$trigger2 -User 'SYSTEM' -RunLevel Highest -Settings $settings -Force"

endlocal
