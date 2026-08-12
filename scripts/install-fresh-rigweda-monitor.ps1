param(
    [string]$Source = "",
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "Programs\RigwedaMonitor")
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

function Get-DefaultSource {
    $scriptDir = $PSScriptRoot
    $candidateFolder = Join-Path $scriptDir "RigwedaMonitor"
    $candidateExe = Join-Path $scriptDir "RigwedaMonitor.exe"

    if (Test-Path $candidateFolder) {
        return $candidateFolder
    }

    if (Test-Path $candidateExe) {
        return $candidateExe
    }

    throw "Source not found. Put RigwedaMonitor.exe or the RigwedaMonitor folder next to this script, or pass -Source."
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

    if (Test-Path $legacyDataRoot) {
        Write-Info "Removing legacy data root..."
        Remove-Item -LiteralPath $legacyDataRoot -Recurse -Force
    }

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

    Write-Info "Removing previous install directory: $InstallDir"
    $safeInstallDir = Assert-SafeTarget $InstallDir (Join-Path $env:LOCALAPPDATA 'Programs') 'Install directory'
    Remove-Item -LiteralPath $safeInstallDir -Recurse -Force
}

function Copy-FreshBuild([string]$ResolvedSource) {
    $sourceItem = Get-Item -LiteralPath $ResolvedSource -ErrorAction Stop

    Write-Info "Installing fresh build from: $ResolvedSource"
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

    if ($sourceItem.PSIsContainer) {
        Get-ChildItem -LiteralPath $sourceItem.FullName -Force | Copy-Item -Destination $InstallDir -Recurse -Force
        return
    }

    Copy-Item -LiteralPath $sourceItem.FullName -Destination (Join-Path $InstallDir $sourceItem.Name) -Force
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

$resolvedSource = if ($Source) { $Source } else { Get-DefaultSource }

Write-Info "Rigweda Monitor fresh install starting..."
Write-Info "Source: $resolvedSource"
Write-Info "InstallDir: $InstallDir"

Stop-RigwedaMonitorProcesses
Remove-StartupEntry
Remove-LocalData
Remove-InstallDir
Copy-FreshBuild -ResolvedSource $resolvedSource
Register-Startup

Write-Info "Install complete."
Write-Info "Launch the app from: $(Join-Path $InstallDir 'RigwedaMonitor.exe')"
