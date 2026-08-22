# Rigweda Monitor kiosk mode

The desktop executable only observes foreground windows during normal use. It
cannot reliably block `Alt+Tab`, the Windows key, Task Manager, secure-attention
sequences, or switching to another desktop. Windows Assigned Access is the
supported mechanism for enforcing single-app use.

## Enable

Install the app normally first, create or choose a dedicated **standard local
Windows user**, then open an elevated PowerShell window and run:

```powershell
cd C:\path\to\Rigweda-Monitor
.\scripts\set-rigweda-kiosk.ps1 -Action Enable -UserName kioskuser
```

Sign out and sign in as that user. Windows will launch only
`RigwedaMonitor.exe` for the assigned account.

The script does not modify ordinary installs or administrator accounts. Do not
assign kiosk mode to an account that needs normal desktop access.

## Disable

From an administrator account or recovery PowerShell session:

```powershell
.\scripts\set-rigweda-kiosk.ps1 -Action Disable -Force
```

Sign out and sign in again. `-Force` is required because disabling Assigned
Access replaces the current Assigned Access configuration on the device.

Assigned Access availability and behavior depend on the Windows edition and
version. The script fails with a clear error when the required Windows provider
is unavailable.