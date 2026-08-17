param(
    [string]$Source = (Join-Path $PSScriptRoot "..\desktop\frontend\dist\RigwedaMonitorFreshInstall\RigwedaMonitor"),
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "Programs\RigwedaMonitor"),
    [switch]$PurgeLegacyData
)

$ErrorActionPreference = "Stop"

function Write-Info([string]$Message) {
    Write-Host $Message
}

function Show-Dialog([string]$Message, [string]$Title = "Rigweda Monitor") {
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop | Out-Null
        [System.Windows.Forms.MessageBox]::Show(
            $Message,
            $Title,
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
    } catch {
        Write-Info $Message
    }
}

function Assert-SafeTarget([string]$TargetPath, [string]$RootPath, [string]$Label) {
    $resolvedTarget = [System.IO.Path]::GetFullPath($TargetPath)
    $resolvedRoot = [System.IO.Path]::GetFullPath($RootPath).TrimEnd('\') + '\'
    if (-not $resolvedTarget.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label is outside the allowed root: $resolvedTarget"
    }
    return $resolvedTarget
}

function Get-AppVersionFromFile([string]$VersionPath) {
    $candidatePaths = @(
        $VersionPath,
        (Join-Path (Split-Path -Parent $VersionPath) "_internal\VERSION")
    )

    foreach ($candidatePath in $candidatePaths) {
        if (-not (Test-Path $candidatePath)) {
            continue
        }

        $rawVersion = (Get-Content -LiteralPath $candidatePath -Raw -ErrorAction SilentlyContinue).Trim()
        if (-not $rawVersion) {
            continue
        }

        try {
            return [version]$rawVersion
        } catch {
            continue
        }
    }

    return $null
}

function Get-SourceVersion {
    $sourceItem = Get-Item -LiteralPath $Source -ErrorAction Stop
    $sourceDir = if ($sourceItem.PSIsContainer) { $sourceItem.FullName } else { Split-Path -Parent $sourceItem.FullName }
    return Get-AppVersionFromFile (Join-Path $sourceDir 'VERSION')
}

function Get-InstalledVersion {
    $installedVersion = Get-AppVersionFromFile (Join-Path $InstallDir 'VERSION')
    if ($installedVersion) {
        return $installedVersion
    }

    $exePath = Join-Path $InstallDir 'RigwedaMonitor.exe'
    if (Test-Path $exePath) {
        $fileVersion = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($exePath).FileVersion
        if ($fileVersion) {
            try {
                return [version]($fileVersion.Split(' ')[0])
            } catch {
                return $null
            }
        }
    }

    return $null
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
    $legacyDataRoot = 'C:\Rigweda_monitor'

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

function Start-InstalledApp {
    $exePath = Join-Path $InstallDir 'RigwedaMonitor.exe'
    if (Test-Path $exePath) {
        Write-Info "Starting installed app..."
        Start-Process -FilePath $exePath -ArgumentList '--background-start' -WorkingDirectory $InstallDir | Out-Null
    }
}

Write-Info "Rigweda Monitor refresh starting..."
Write-Info "Source: $Source"
Write-Info "InstallDir: $InstallDir"

$sourceVersion = Get-SourceVersion
$installedVersion = Get-InstalledVersion
if ($sourceVersion) {
    Write-Info "Source version: $sourceVersion"
}
if ($installedVersion) {
    Write-Info "Installed version: $installedVersion"
}

if ($installedVersion -and $sourceVersion -and $installedVersion -eq $sourceVersion) {
    $alreadyInstalledMessage = "Rigweda Monitor is already installed.`nVersion: $(if ($installedVersion) { $installedVersion } else { 'unknown' })"
    Write-Info "Already installed: version $installedVersion"
    Show-Dialog $alreadyInstalledMessage "Rigweda Monitor"
    exit 0
}

if ($installedVersion -and $sourceVersion -and $installedVersion -lt $sourceVersion) {
    Write-Info "Update available: $installedVersion -> $sourceVersion"
} elseif ($installedVersion -and $sourceVersion -and $installedVersion -gt $sourceVersion) {
    Write-Info "Installed version $installedVersion is newer than source version $sourceVersion. Reinstalling source build."
} elseif (-not $installedVersion) {
    Write-Info "No installed version detected. Installing fresh build."
}

Stop-RigwedaMonitorProcesses
Remove-StartupEntry
if ($PurgeLegacyData) {
    Remove-LocalData
}
Remove-InstallDir
Copy-FreshBuild
Register-Startup
Start-InstalledApp

if ($installedVersion -and $sourceVersion -and $installedVersion -lt $sourceVersion) {
    Write-Info "Update complete."
    Show-Dialog "Rigweda Monitor has been updated.`nInstalled version: $(if ($sourceVersion) { $sourceVersion } else { 'unknown' })" "Rigweda Monitor Update"
} else {
    Write-Info "Refresh complete."
    Show-Dialog "Rigweda Monitor has been installed.`nVersion: $(if ($sourceVersion) { $sourceVersion } else { 'unknown' })" "Rigweda Monitor"
}
Write-Info "Launch the app from: $(Join-Path $InstallDir 'RigwedaMonitor.exe')"
