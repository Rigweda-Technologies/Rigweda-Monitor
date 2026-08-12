param(
    [string]$Source = (Join-Path $PSScriptRoot "..\desktop\frontend\dist\RigwedaMonitor"),
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "Programs\RigwedaMonitor"),
    [switch]$PurgeLegacyData
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
    Write-Info "Stopping existing Rigweda Monitor processes..."
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.ProcessId -ne $PID -and
            $_.CommandLine -and (
                $_.CommandLine -match 'RigwedaMonitor' -or
                $_.CommandLine -match 'app\.main' -or
                $_.CommandLine -match 'screenshot\.py' -or
                $_.CommandLine -match 'activity_monitor\.py'
            )
        } |
        ForEach-Object {
            try {
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            } catch {
                Write-Info "  Could not stop PID $($_.ProcessId): $($_.Exception.Message)"
            }
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

function Remove-LocalData {
    $dataRoot = Join-Path $env:LOCALAPPDATA 'rigweda-monitor'
    $legacyDataRoot = 'C:\Rigweda_monitor'

    Write-Info "Removing local app data..."
    if (Test-Path $dataRoot) {
        $safeDataRoot = Assert-SafeTarget $dataRoot $env:LOCALAPPDATA 'Local data root'
        Remove-Item -LiteralPath $safeDataRoot -Recurse -Force
    }

    if ($PurgeLegacyData -and (Test-Path $legacyDataRoot)) {
        Write-Info "Removing legacy data root..."
        Remove-Item -LiteralPath $legacyDataRoot -Recurse -Force
    }
}

function Remove-InstallDir {
    if (-not (Test-Path $InstallDir)) {
        return
    }

    Write-Info "Removing previous install directory: $InstallDir"
    $safeInstallDir = Assert-SafeTarget $InstallDir (Join-Path $env:LOCALAPPDATA 'Programs') 'Install directory'
    Remove-Item -LiteralPath $safeInstallDir -Recurse -Force
}

function Copy-FreshBuild {
    $sourceItem = Get-Item -LiteralPath $Source -ErrorAction Stop
    $sourceDir = if ($sourceItem.PSIsContainer) { $sourceItem.FullName } else { Split-Path -Parent $sourceItem.FullName }

    if (-not (Test-Path $sourceDir)) {
        throw "Source directory not found: $sourceDir"
    }

    $exeName = 'RigwedaMonitor.exe'
    if (-not (Get-ChildItem -LiteralPath $sourceDir -Filter $exeName -File -ErrorAction SilentlyContinue)) {
        Write-Info "Warning: $exeName was not found directly under $sourceDir."
    }

    Write-Info "Installing fresh build from: $sourceDir"
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Get-ChildItem -LiteralPath $sourceDir -Force | Copy-Item -Destination $InstallDir -Recurse -Force
}

function Register-Startup {
    $exePath = Join-Path $InstallDir 'RigwedaMonitor.exe'
    if (-not (Test-Path $exePath)) {
        throw "Installed exe not found: $exePath"
    }

    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    $command = "`"$exePath`" --background-start"
    Set-ItemProperty -Path $runKey -Name 'RigwedaMonitor' -Value $command
    Write-Info "Registered startup command: $command"
}

Write-Info "Rigweda Monitor refresh starting..."
Write-Info "Source: $Source"
Write-Info "InstallDir: $InstallDir"

Stop-RigwedaMonitorProcesses
Remove-StartupEntry
Remove-LocalData
Remove-InstallDir
Copy-FreshBuild
Register-Startup

Write-Info "Refresh complete."
Write-Info "Launch the app from: $(Join-Path $InstallDir 'RigwedaMonitor.exe')"
