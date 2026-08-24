param(
  [string]$ConfigPath = "C:\Program Files\RigwedaMonitor\config.json",
  [string]$VersionPath = "C:\Program Files\RigwedaMonitor\version.json"
)

$ErrorActionPreference = "Stop"

function Write-Log([string]$Message) {
  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  $logPath = Join-Path $config.runtimeRoot "logs\updater.log"
  $logDir = Split-Path -Parent $logPath
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  Add-Content -LiteralPath $logPath -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message)
}

function Get-AuthToken {
  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  $authFile = Join-Path $config.runtimeRoot "data\auth.json"
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
  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  $deviceIdFile = Join-Path $config.runtimeRoot "data\device_id.txt"
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
    $uri = "{0}/api/monitor/update/status" -f $config.hrmsBackendUrl.TrimEnd("/")
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
  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  $stateDir = Join-Path $config.runtimeRoot "state"
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
  $mutex = New-Object System.Threading.Mutex($false, "Global\RigwedaMonitorUpdate")
  if (-not $mutex.WaitOne(0)) {
    Write-Log "UPDATE_ALREADY_RUNNING"
    exit 0
  }
  return $mutex
}

function Get-InstalledVersion {
  if (Test-Path $VersionPath) {
    try { return (Get-Content -LiteralPath $VersionPath -Raw | ConvertFrom-Json).version } catch {}
  }
  $exe = "C:\Program Files\RigwedaMonitor\RigwedaMonitor.exe"
  if (Test-Path $exe) {
    return [System.Diagnostics.FileVersionInfo]::GetVersionInfo($exe).FileVersion
  }
  return "0.0.0"
}

function Restart-App {
  $exe = "C:\Program Files\RigwedaMonitor\RigwedaMonitor.exe"
  Start-Process -FilePath $exe -WindowStyle Hidden | Out-Null
}

function Test-Signature([string]$FilePath, [string]$Publisher) {
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

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$authToken = Get-AuthToken
$deviceId = Get-DeviceId
$mutex = Get-Lock

try {
  $installedVersion = Get-InstalledVersion
  Write-Log "UPDATE_CHECK_STARTED CURRENT_VERSION=$installedVersion"
  $latestResponse = Invoke-RestMethod -Method Get -Uri "$($config.hrmsBackendUrl.TrimEnd('/'))/api/monitor/update/latest" -Headers @{
    Authorization = "Bearer $authToken"
    "X-Device-ID" = $deviceId
    "X-App-Version" = $installedVersion
  }

  $update = $latestResponse.data
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

  $downloadDir = Join-Path $config.runtimeRoot "downloads"
  $backupDir = Join-Path $config.runtimeRoot "backup"
  $stateDir = Join-Path $config.runtimeRoot "state"
  New-Item -ItemType Directory -Force -Path $downloadDir, $backupDir, $stateDir | Out-Null
  $targetExe = Join-Path $downloadDir ("RigwedaMonitor-{0}.exe" -f $update.version)
  $exePath = "C:\Program Files\RigwedaMonitor\RigwedaMonitor.exe"
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

  $serviceName = "RigwedaMonitor"
  if (Get-Process -Name $serviceName -ErrorAction SilentlyContinue) {
    Stop-Process -Name $serviceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 5
  }

  Copy-Item -Path $exePath -Destination $backupPath -Force
  Copy-Item -Path $targetExe -Destination $exePath -Force
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
