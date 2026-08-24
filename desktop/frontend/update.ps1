param(
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA "Programs\RigwedaMonitor\config.json"),
  [string]$VersionPath = (Join-Path $env:LOCALAPPDATA "Programs\RigwedaMonitor\version.json")
)

$ErrorActionPreference = "Stop"

function Write-Log([string]$Message) {
  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  $logPath = Join-Path $config.runtimeRoot "logs\updater.log"
  $logDir = Split-Path -Parent $logPath
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  Add-Content -LiteralPath $logPath -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message)
}

function Get-RuntimeRoot {
  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  $runtimeRoot = [string]$config.runtimeRoot
  if ([string]::IsNullOrWhiteSpace($runtimeRoot)) {
    $runtimeRoot = Join-Path $env:LOCALAPPDATA "rigweda-monitor"
  }
  return $runtimeRoot
}

function Get-AuthToken {
  $authFile = Join-Path (Get-RuntimeRoot) "data\auth.json"
  if (-not (Test-Path $authFile)) {
    throw "Auth session not found at $authFile"
  }

  $auth = Get-Content -LiteralPath $authFile -Raw | ConvertFrom-Json
  $token = $auth.accessToken
  if (-not $token) {
    $token = $auth.token
  }
  if (-not $token -and $auth.data -is [object]) {
    $token = $auth.data.accessToken
  }
  if (-not $token) {
    throw "HRMS login token not found in auth session."
  }

  return [string]$token
}

function Get-DeviceId {
  $deviceIdFile = Join-Path (Get-RuntimeRoot) "data\device_id.txt"
  if (-not (Test-Path $deviceIdFile)) {
    throw "Device ID file not found at $deviceIdFile"
  }

  $deviceId = (Get-Content -LiteralPath $deviceIdFile -Raw).Trim()
  if (-not $deviceId) {
    throw "Device ID file is empty."
  }

  return $deviceId
}

function Send-Status([hashtable]$Payload) {
  try {
    $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    $token = Get-AuthToken
    $deviceId = Get-DeviceId
    $uri = "{0}/monitor/update/status" -f $config.hrmsBackendUrl.TrimEnd("/")
    Invoke-RestMethod -Method Post -Uri $uri -Headers @{
      Authorization = "Bearer $token"
      "Content-Type" = "application/json"
      "X-Device-ID" = $deviceId
    } -Body ($Payload | ConvertTo-Json -Depth 10) | Out-Null
  } catch {
    Write-Log "STATUS_REPORT_FAILED $($_.Exception.Message)"
  }
}

function Get-Lock {
  $stateDir = Join-Path (Get-RuntimeRoot) "state"
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
  $mutex = New-Object System.Threading.Mutex($false, "Global\RigwedaMonitorUpdate")
  if (-not $mutex.WaitOne(0)) {
    Write-Log "UPDATE_ALREADY_RUNNING"
    exit 0
  }
  return $mutex
}

function Get-ResponseData([object]$Response) {
  if ($null -eq $Response) {
    return $null
  }

  if ($Response.PSObject.Properties.Name -contains 'data' -and $null -ne $Response.data) {
    return $Response.data
  }

  return $Response
}

function Get-InstallRoot {
  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  $installRoot = [string]$config.installRoot
  if ([string]::IsNullOrWhiteSpace($installRoot)) {
    $installRoot = $PSScriptRoot
  }
  return $installRoot
}

function Get-InstalledVersion {
  if (Test-Path (Join-Path (Get-InstallRoot) "VERSION")) {
    try {
      $plainVersion = (Get-Content -LiteralPath (Join-Path (Get-InstallRoot) "VERSION") -Raw).Trim()
      if ($plainVersion) {
        return $plainVersion
      }
    } catch {}
  }

  if (Test-Path $VersionPath) {
    try {
      $versionFile = Get-Content -LiteralPath $VersionPath -Raw
      try {
        $versionJson = $versionFile | ConvertFrom-Json
        if ($versionJson.version) {
          return [string]$versionJson.version
        }
      } catch {}

      $plainVersion = [string]$versionFile.Trim()
      if ($plainVersion) {
        return $plainVersion
      }
    } catch {}
  }
  $exe = Join-Path (Get-InstallRoot) "RigwedaMonitor.exe"
  if (Test-Path $exe) {
    return [System.Diagnostics.FileVersionInfo]::GetVersionInfo($exe).FileVersion
  }
  return "0.0.0"
}

function Restart-App {
  $exe = Join-Path (Get-InstallRoot) "RigwedaMonitor.exe"
  Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) | Out-Null
}

function Test-Signature([string]$FilePath, [string]$Publisher) {
  if (([string]$env:MONITOR_SKIP_SIGNATURE_CHECK).Trim().ToLower() -in @("1", "true", "yes")) {
    Write-Log "SIGNATURE_CHECK_SKIPPED FILE=$FilePath"
    return
  }

  $signature = Get-AuthenticodeSignature -FilePath $FilePath
  if ($signature.Status -ne "Valid") {
    throw "Signature invalid: $($signature.Status)"
  }
  if ($Publisher) {
    $subject = $signature.SignerCertificate.Subject
    if ($subject -notmatch [regex]::Escape($Publisher)) {
      throw "Unexpected publisher: $subject"
    }
  }
}

function Stop-RigwedaMonitorApp {
  & taskkill /F /IM RigwedaMonitor.exe /T | Out-Null
  for ($i = 0; $i -lt 30; $i++) {
    if (-not (Get-Process -Name "RigwedaMonitor" -ErrorAction SilentlyContinue)) {
      return
    }
    Start-Sleep -Seconds 1
  }
}

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$authToken = Get-AuthToken
$deviceId = Get-DeviceId
$mutex = Get-Lock

try {
  $installedVersion = Get-InstalledVersion
  Write-Log "UPDATE_CHECK_STARTED CURRENT_VERSION=$installedVersion"
  $latestResponse = Invoke-RestMethod -Method Get -Uri "$($config.hrmsBackendUrl.TrimEnd('/'))/monitor/update/latest" -Headers @{
    Authorization = "Bearer $authToken"
    "X-Device-ID" = $deviceId
    "X-App-Version" = $installedVersion
  }
  if ($null -eq $latestResponse) {
    throw "Latest update response was empty."
  }

  $update = Get-ResponseData $latestResponse
  if ($null -eq $update) {
    throw "Latest update response did not include update data."
  }
  if (-not $update.updateAvailable) {
    Write-Log "UP_TO_DATE"
    Send-Status @{
      deviceId = $deviceId
      fromVersion = $installedVersion
      toVersion = $installedVersion
      status = "UP_TO_DATE"
      timestamp = (Get-Date).ToUniversalTime().ToString("o")
    }
    exit 0
  }

  $runtimeRoot = Get-RuntimeRoot
  $downloadDir = Join-Path $runtimeRoot "downloads"
  $backupDir = Join-Path $runtimeRoot "backup"
  $stateDir = Join-Path $runtimeRoot "state"
  New-Item -ItemType Directory -Force -Path $downloadDir, $backupDir, $stateDir | Out-Null
  $targetExe = Join-Path $downloadDir ("RigwedaMonitor-{0}.exe" -f $update.version)
  $exePath = Join-Path (Get-InstallRoot) "RigwedaMonitor.exe"
  $backupPath = Join-Path $backupDir ("RigwedaMonitor-{0}.exe" -f $installedVersion)

  Write-Log "DOWNLOAD_STARTED RELEASE=$($update.version)"
  Send-Status @{
    deviceId = $deviceId
    releaseId = $update.releaseId
    fromVersion = $installedVersion
    toVersion = $update.version
    status = "DOWNLOAD_STARTED"
    timestamp = (Get-Date).ToUniversalTime().ToString("o")
  }

  Invoke-WebRequest -Uri $update.downloadUrl -OutFile $targetExe
  if ((Get-FileHash -Algorithm SHA256 -Path $targetExe).Hash.ToLower() -ne $update.sha256.ToLower()) {
    Remove-Item -Force $targetExe -ErrorAction SilentlyContinue
    Write-Log "HASH_MISMATCH"
    Send-Status @{
      deviceId = $deviceId
      releaseId = $update.releaseId
      fromVersion = $installedVersion
      toVersion = $update.version
      status = "FAILED"
      errorCode = "HASH_MISMATCH"
      errorMessage = "Downloaded file verification failed."
      timestamp = (Get-Date).ToUniversalTime().ToString("o")
    }
    exit 1
  }

  Test-Signature -FilePath $targetExe -Publisher $config.expectedPublisher

  Stop-RigwedaMonitorApp

  Copy-Item -Path $exePath -Destination $backupPath -Force
  Copy-Item -Path $targetExe -Destination $exePath -Force
  Set-Content -LiteralPath (Join-Path (Get-InstallRoot) "VERSION") -Value $update.version -Encoding ASCII
  Write-Log "INSTALL_STARTED"
  Send-Status @{
    deviceId = $deviceId
    releaseId = $update.releaseId
    fromVersion = $installedVersion
    toVersion = $update.version
    status = "INSTALLING"
    timestamp = (Get-Date).ToUniversalTime().ToString("o")
  }

  Restart-App
  Start-Sleep -Seconds 20
  $newVersion = Get-InstalledVersion
  if ($newVersion -ne $update.version) {
    Copy-Item -Path $backupPath -Destination $exePath -Force
    Set-Content -LiteralPath (Join-Path (Get-InstallRoot) "VERSION") -Value $installedVersion -Encoding ASCII
    Restart-App
    Write-Log "ROLLED_BACK VERSION=$installedVersion"
    Send-Status @{
      deviceId = $deviceId
      releaseId = $update.releaseId
      fromVersion = $installedVersion
      toVersion = $update.version
      status = "ROLLED_BACK"
      errorCode = "VERSION_VALIDATION_FAILED"
      errorMessage = "Installed version mismatch after restart."
      timestamp = (Get-Date).ToUniversalTime().ToString("o")
    }
    exit 1
  }

  Set-Content -LiteralPath $VersionPath -Value (@{
    version = $update.version
    build = $update.build
    installedAt = (Get-Date).ToUniversalTime().ToString("o")
  } | ConvertTo-Json -Depth 4) -Encoding UTF8

  Write-Log "UPDATE_SUCCESS VERSION=$update.version"
  Send-Status @{
    deviceId = $deviceId
    releaseId = $update.releaseId
    fromVersion = $installedVersion
    toVersion = $update.version
    status = "UPDATED"
    timestamp = (Get-Date).ToUniversalTime().ToString("o")
  }
} catch {
  Write-Log "FAILED $($_.Exception.Message)"
  try {
    Send-Status @{
      deviceId = $deviceId
      status = "FAILED"
      errorCode = "UPDATE_EXCEPTION"
      errorMessage = $_.Exception.Message
      timestamp = (Get-Date).ToUniversalTime().ToString("o")
    }
  } catch {}
  exit 1
} finally {
  if ($mutex) { $mutex.ReleaseMutex() | Out-Null; $mutex.Dispose() }
}
