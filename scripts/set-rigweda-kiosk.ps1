param(
    [ValidateSet('Enable', 'Disable')]
    [string]$Action = 'Enable',
    [string]$UserName = $env:USERNAME,
    [string]$ExePath = (Join-Path $env:LOCALAPPDATA 'Programs\RigwedaMonitor\RigwedaMonitor.exe'),
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run this script from an elevated PowerShell window (Run as administrator).'
    }
}

function Get-AssignedAccessInstance {
    $instance = Get-CimInstance -Namespace 'root/cimv2/mdm/dmmap' -ClassName 'MDM_AssignedAccess' -ErrorAction Stop
    if (-not $instance) {
        throw 'Windows Assigned Access is unavailable on this device.'
    }
    return $instance
}

function Set-AssignedAccessConfiguration([string]$ConfigurationXml) {
    $instance = Get-AssignedAccessInstance
    $instance.Configuration = [System.Net.WebUtility]::HtmlEncode($ConfigurationXml)
    Set-CimInstance -CimInstance $instance | Out-Null
}

Assert-Administrator

if ($Action -eq 'Disable') {
    if (-not $Force) {
        throw 'Disabling Assigned Access changes the device policy. Re-run with -Action Disable -Force after confirming this is the intended kiosk policy.'
    }

    Set-AssignedAccessConfiguration ''
    Write-Host 'Rigweda Monitor kiosk mode disabled. Sign out and sign back in for the change to take effect.'
    exit 0
}

if (-not (Test-Path -LiteralPath $ExePath -PathType Leaf)) {
    throw "Rigweda Monitor executable was not found: $ExePath"
}

$account = Get-LocalUser -Name $UserName -ErrorAction SilentlyContinue
if (-not $account) {
    throw "Local Windows user was not found: $UserName. Pass -UserName for the standard kiosk account."
}
if ($account.Enabled -eq $false) {
    throw "Windows user is disabled: $UserName"
}
$administratorMembers = Get-LocalGroupMember -Group 'Administrators' -ErrorAction SilentlyContinue
if ($administratorMembers | Where-Object { $_.Name -match "(^|\\)$([regex]::Escape($UserName))$" }) {
    throw "Windows user must be a standard user, not a member of Administrators: $UserName"
}

$profileId = '{9D1C95F1-8B4D-4A9C-A2C8-9D390A9E5A40}'
$escapedExePath = [System.Security.SecurityElement]::Escape($ExePath)
$escapedUserName = [System.Security.SecurityElement]::Escape($UserName)
$configuration = @"
<?xml version="1.0" encoding="utf-8" ?>
<AssignedAccessConfiguration xmlns="http://schemas.microsoft.com/AssignedAccess/2017/config"
    xmlns:v4="http://schemas.microsoft.com/AssignedAccess/2021/config">
    <Profiles>
        <Profile Id="$profileId" Name="Rigweda Monitor kiosk">
            <KioskModeApp v4:ClassicAppPath="$escapedExePath" />
        </Profile>
    </Profiles>
    <Configs>
        <Config>
            <Account>$escapedUserName</Account>
            <DefaultProfile Id="$profileId" />
        </Config>
    </Configs>
</AssignedAccessConfiguration>
"@

Set-AssignedAccessConfiguration $configuration
Write-Host "Rigweda Monitor kiosk mode enabled for $UserName. Sign out and sign back in to apply it."
Write-Host 'Use Ctrl+Alt+Del to reach the Windows recovery/sign-out options. To remove this policy, run this script with -Action Disable -Force as administrator.'