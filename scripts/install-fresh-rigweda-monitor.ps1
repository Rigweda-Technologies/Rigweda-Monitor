param(
    [string]$Source = "",
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\RigwedaMonitor'),
    [string]$DataRoot = (Join-Path $env:LOCALAPPDATA 'rigweda-monitor\data'),
    [string]$LogRoot = (Join-Path $env:LOCALAPPDATA 'rigweda-monitor\logs'),
    [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA 'rigweda-monitor'),
    [string]$HrmsBackendUrl = $env:HRMS_BACKEND_URL,
    [string]$ExpectedPublisher = $env:MONITOR_EXPECTED_PUBLISHER,
    [bool]$AllowUnsignedUpdates = $true
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

function Get-SourceVersion([string]$ResolvedSource) {
    $sourceItem = Get-Item -LiteralPath $ResolvedSource -ErrorAction Stop
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
            $_.Name -in @('cmd.exe', 'python.exe', 'pythonw.exe', 'RigwedaMonitor.exe') -and
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

function Remove-PrivilegedStartupTask {
    $taskName = 'RigwedaMonitor'
    try {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
        Write-Info "Removed scheduled startup task: $taskName"
    } catch {
        Write-Info "  Scheduled startup task was not removed cleanly: $($_.Exception.Message)"
    }
}

function Test-PrivilegedStartupTask {
    return $null -ne (Get-ScheduledTask -TaskName 'RigwedaMonitor' -ErrorAction SilentlyContinue)
}

function Remove-LegacyService {
    $legacyServiceName = 'RigwedaMonitorService'
    $service = Get-Service -Name $legacyServiceName -ErrorAction SilentlyContinue
    if (-not $service) {
        return
    }

    Write-Info "Removing legacy Windows service: $legacyServiceName"
    try {
        if ($service.Status -ne 'Stopped') {
            Stop-Service -Name $legacyServiceName -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
        }
    } catch {
        Write-Info "  Could not stop legacy service cleanly: $($_.Exception.Message)"
    }

    try {
        & sc.exe delete $legacyServiceName | Out-Null
    } catch {
        Write-Info "  Could not delete legacy service cleanly: $($_.Exception.Message)"
    }
}

function Remove-LocalData {
    $legacyDataRoot = 'C:\Rigweda_monitor'

    Write-Info "Removing local screenshot cache and logs..."
    if (Test-Path $LogRoot) {
        $safeLogRoot = Assert-SafeTarget $LogRoot $env:LOCALAPPDATA 'Local log root'
        Remove-Item -LiteralPath $safeLogRoot -Recurse -Force
    }

    if (Test-Path $legacyDataRoot) {
        Write-Info "Removing legacy data root..."
        Remove-Item -LiteralPath $legacyDataRoot -Recurse -Force
    }

    if (Test-Path $DataRoot) {
        Write-Info "Preserving session and device data in: $DataRoot"
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
    $sourceDir = if ($sourceItem.PSIsContainer) { $sourceItem.FullName } else { Split-Path -Parent $sourceItem.FullName }

    Write-Info "Installing build from: $sourceDir"
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

    Get-ChildItem -LiteralPath $sourceDir -Force | Copy-Item -Destination $InstallDir -Recurse -Force
}

function Copy-InstallHelpers {
    $helperFiles = @(
        'update.ps1',
        'install_update_task.bat',
        'uninstall-rigweda-monitor.ps1',
        'uninstall-rigweda-monitor.bat'
    )

    foreach ($helperFile in $helperFiles) {
        $sourcePath = Join-Path $PSScriptRoot $helperFile
        if (Test-Path $sourcePath) {
            Copy-Item -LiteralPath $sourcePath -Destination $InstallDir -Force
        }
    }
}

function Initialize-RuntimeRoots {
    New-Item -ItemType Directory -Path $RuntimeRoot, $DataRoot, $LogRoot -Force | Out-Null
}

function Write-UpdateConfig {
    $configPath = Join-Path $InstallDir 'config.json'
    $payload = @{
        hrmsBackendUrl = if ($HrmsBackendUrl) { $HrmsBackendUrl } else { "https://rigweda-hrms-backend.onrender.com/api" }
        expectedPublisher = if ($ExpectedPublisher) { $ExpectedPublisher } else { "" }
        allowUnsignedUpdates = $AllowUnsignedUpdates
        runtimeRoot = $RuntimeRoot
        installRoot = $InstallDir
    }
    $payload | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding UTF8
}

function Register-Startup {
    $exePath = Join-Path $InstallDir 'RigwedaMonitor.exe'
    if (-not (Test-Path $exePath)) {
        throw "Installed exe not found: $exePath"
    }

    $taskName = 'RigwedaMonitor'
    $userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $action = New-ScheduledTaskAction -Execute $exePath -Argument '--background-start' -WorkingDirectory $InstallDir
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    Write-Info "Registered elevated scheduled startup task: $taskName for $userId"
}

function Start-InstalledApp {
    $exePath = Join-Path $InstallDir 'RigwedaMonitor.exe'
    if (Test-Path $exePath) {
        Write-Info "Starting installed app..."
        Start-Process -FilePath $exePath -ArgumentList '--background-start' -WorkingDirectory $InstallDir | Out-Null
    }
}

function Install-UpdateTask {
    $taskScript = Join-Path $InstallDir 'install_update_task.bat'
    if (Test-Path $taskScript) {
        Write-Info "Registering scheduled update task..."
        $process = Start-Process -FilePath $taskScript -WorkingDirectory $InstallDir -Wait -PassThru
        if ($process.ExitCode -ne 0) {
            throw "Failed to register scheduled update task. Exit code: $($process.ExitCode)"
        }
    }
}

$resolvedSource = if ($Source) { $Source } else { Get-DefaultSource }
$sourceVersion = Get-SourceVersion $resolvedSource
$installedVersion = Get-InstalledVersion

Write-Info "Rigweda Monitor fresh install starting..."
Write-Info "Source: $resolvedSource"
Write-Info "InstallDir: $InstallDir"
Write-Info "DataRoot: $DataRoot"
Write-Info "LogRoot: $LogRoot"

if ($sourceVersion) {
    Write-Info "Source version: $sourceVersion"
}
if ($installedVersion) {
    Write-Info "Installed version: $installedVersion"
}

if ($installedVersion -and $sourceVersion -and $installedVersion -eq $sourceVersion -and (Test-PrivilegedStartupTask)) {
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
Remove-PrivilegedStartupTask
Remove-LegacyService
Remove-LocalData
Remove-InstallDir
Copy-FreshBuild -ResolvedSource $resolvedSource
Copy-InstallHelpers
Initialize-RuntimeRoots
Write-UpdateConfig
Install-UpdateTask
Register-Startup
Start-InstalledApp

if ($installedVersion -and $sourceVersion -and $installedVersion -lt $sourceVersion) {
    Write-Info "Update complete."
    Show-Dialog "Rigweda Monitor has been updated.`nInstalled version: $(if ($sourceVersion) { $sourceVersion } else { 'unknown' })" "Rigweda Monitor Update"
} else {
    Write-Info "Install complete."
    Show-Dialog "Rigweda Monitor has been installed.`nVersion: $(if ($sourceVersion) { $sourceVersion } else { 'unknown' })" "Rigweda Monitor"
}
Write-Info "Launch the app from: $(Join-Path $InstallDir 'RigwedaMonitor.exe')"
