param(
    [int]$WaitSeconds = 10
)

$ErrorActionPreference = "Stop"

$patterns = @(
    'RigwedaMonitor',
    'app.main',
    'screenshot.py',
    'activity_monitor.py',
    'keyboard_usage_monitor.py'
)

function Test-RigwedaProcess {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Process
    )

    if ($Process.ProcessId -eq $PID -or -not $Process.CommandLine) {
        return $false
    }

    if ($Process.Name -and $Process.Name -like 'RigwedaMonitor*') {
        return $true
    }

    if ($Process.Name -notin @('cmd.exe', 'python.exe', 'pythonw.exe', 'RigwedaMonitor.exe')) {
        return $false
    }

    foreach ($pattern in $patterns) {
        if ($Process.CommandLine -match [regex]::Escape($pattern)) {
            return $true
        }
    }

    return $false
}

function Get-RigwedaProcessMatches {
    try {
        return Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { Test-RigwedaProcess -Process $_ }
    } catch {
        return Get-Process -ErrorAction SilentlyContinue |
            Where-Object { $_.ProcessName -like 'RigwedaMonitor*' } |
            Select-Object @{ Name = 'ProcessId'; Expression = { $_.Id } }, @{ Name = 'Name'; Expression = { $_.ProcessName } }
    }
}

for ($attempt = 1; $attempt -le 5; $attempt++) {
    $matches = Get-RigwedaProcessMatches
    if (-not $matches) {
        break
    }

    $matches | ForEach-Object {
        try {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        } catch {
            Write-Host "Could not stop PID $($_.ProcessId): $($_.Exception.Message)"
        }
    }

    Start-Sleep -Seconds 2
}

if ($WaitSeconds -gt 0) {
    Start-Sleep -Seconds $WaitSeconds
}

$remaining = Get-RigwedaProcessMatches
if ($remaining) {
    Write-Host "Rigweda Monitor processes are still running:"
    $remaining | ForEach-Object {
        $processName = if ($_.Name) { $_.Name } else { $_.ProcessName }
        Write-Host ("  PID {0} {1}" -f $_.ProcessId, $processName)
    }
    exit 1
}
