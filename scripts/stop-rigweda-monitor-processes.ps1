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

    foreach ($pattern in $patterns) {
        if ($Process.CommandLine -match [regex]::Escape($pattern)) {
            return $true
        }
    }

    return $false
}

for ($attempt = 1; $attempt -le 5; $attempt++) {
    $matches = Get-CimInstance Win32_Process | Where-Object { Test-RigwedaProcess -Process $_ }
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

$remaining = Get-CimInstance Win32_Process | Where-Object { Test-RigwedaProcess -Process $_ }
if ($remaining) {
    Write-Host "Rigweda Monitor processes are still running:"
    $remaining | ForEach-Object {
        Write-Host ("  PID {0} {1}" -f $_.ProcessId, $_.Name)
    }
    exit 1
}
