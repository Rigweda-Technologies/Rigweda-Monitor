param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "Programs\RigwedaMonitor"),
    [string]$DataRoot = (Join-Path $env:LOCALAPPDATA "rigweda-monitor\data"),
    [string]$LogRoot = (Join-Path $env:LOCALAPPDATA "rigweda-monitor\logs"),
    [string]$LegacyDataRoot = "C:\Rigweda_monitor"
)

$ErrorActionPreference = "Stop"

function Write-Info([string]$Message) {
    Write-Host $Message
}

function Assert-SafeTarget([string]$TargetPath, [string]$RootPath, [string]$Label) {
    $resolvedTarget = [System.IO.Path]::GetFullPath($TargetPath)
    $resolvedRoot = [System.IO.Path]::GetFullPath($RootPath).TrimEnd('\') + '\'
    if (-not $resolvedTarget.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label is outside the allowed root: $resolvedTarget"
    }
    return $resolvedTarget
}

function Stop-RigwedaMonitorProcesses {
    Write-Info "Stopping Rigweda Monitor processes..."

    $patterns = @(
        'RigwedaMonitor',
        'app.main',
        'screenshot.py',
        'activity_monitor.py',
        'keyboard_usage_monitor.py',
        '--background-start',
        '--screenshot-monitor',
        '--activity-monitor',
        '--keyboard-monitor'
    )

    $processes = Get-CimInstance Win32_Process | Where-Object {
        $process = $_
        if ($process.ProcessId -eq $PID -or -not $process.CommandLine) {
            return $false
        }

        if ($process.Name -like 'RigwedaMonitor*') {
            return $true
        }

        foreach ($pattern in $patterns) {
            if ($process.CommandLine -match [regex]::Escape($pattern)) {
                return $true
            }
        }

        return $false
    }

    foreach ($process in $processes) {
        try {
            Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
        } catch {
            Write-Info "  Could not stop PID $($process.ProcessId): $($_.Exception.Message)"
        }
    }

    Start-Sleep -Seconds 2
}

function Remove-RigwedaMonitorService {
    $serviceName = 'MyAppBackendService'
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if (-not $service) {
        return
    }

    Write-Info "Removing Windows service: $serviceName"
    try {
        if ($service.Status -ne 'Stopped') {
            Stop-Service -Name $serviceName -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
        }
    } catch {
        Write-Info "  Could not stop service cleanly: $($_.Exception.Message)"
    }

    try {
        & sc.exe delete $serviceName | Out-Null
    } catch {
        Write-Info "  Could not delete service cleanly: $($_.Exception.Message)"
    }
}

function Remove-StartupEntry {
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    $valueName = 'RigwedaMonitor'

    Write-Info "Removing Windows startup entry..."
    try {
        if (Get-ItemProperty -Path $runKey -Name $valueName -ErrorAction SilentlyContinue) {
            Remove-ItemProperty -Path $runKey -Name $valueName -ErrorAction Stop
        }
    } catch {
        Write-Info "  Startup entry was not removed cleanly: $($_.Exception.Message)"
    }
}

function Remove-Shortcuts {
    Write-Info "Removing shortcuts..."
    $shortcutRoots = @(
        (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
        (Join-Path $env:USERPROFILE 'Desktop')
    )

    foreach ($shortcutRoot in $shortcutRoots) {
        if (-not (Test-Path $shortcutRoot)) {
            continue
        }

        Get-ChildItem -LiteralPath $shortcutRoot -Filter '*RigwedaMonitor*.lnk' -File -ErrorAction SilentlyContinue |
            ForEach-Object {
                try {
                    Remove-Item -LiteralPath $_.FullName -Force
                } catch {
                    Write-Info "  Could not remove shortcut $($_.FullName): $($_.Exception.Message)"
                }
            }
    }
}

function Remove-InstallDir {
    if (-not (Test-Path $InstallDir)) {
        return
    }

    Write-Info "Removing installed files: $InstallDir"
    $safeInstallDir = Assert-SafeTarget $InstallDir (Join-Path $env:LOCALAPPDATA 'Programs') 'Install directory'
    Remove-Item -LiteralPath $safeInstallDir -Recurse -Force
}

function Remove-LocalData {
    Write-Info "Removing local monitor data and logs..."

    if (Test-Path $DataRoot) {
        $safeDataRoot = Assert-SafeTarget $DataRoot $env:LOCALAPPDATA 'Local data root'
        Remove-Item -LiteralPath $safeDataRoot -Recurse -Force
    }

    if (Test-Path $LogRoot) {
        $safeLogRoot = Assert-SafeTarget $LogRoot $env:LOCALAPPDATA 'Local log root'
        Remove-Item -LiteralPath $safeLogRoot -Recurse -Force
    }

    if (Test-Path $LegacyDataRoot) {
        Write-Info "Removing legacy data root..."
        Remove-Item -LiteralPath $LegacyDataRoot -Recurse -Force
    }
}

Write-Info "Rigweda Monitor uninstall starting..."
Write-Info "InstallDir: $InstallDir"
Write-Info "DataRoot: $DataRoot"
Write-Info "LogRoot: $LogRoot"

Stop-RigwedaMonitorProcesses
Remove-RigwedaMonitorService
Remove-StartupEntry
Remove-Shortcuts
Remove-InstallDir
Remove-LocalData

Write-Info "Uninstall complete."
