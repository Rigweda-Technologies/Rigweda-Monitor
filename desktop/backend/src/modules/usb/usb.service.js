import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getPool } from "../../database/pool.js";
import { getUsbSettingsFallback, normalizeUsbMode, resolveUsbSettingsFromRigweda } from "../../integrations/usb.js";

const execFileAsync = promisify(execFile);
const TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS monitor_usb_settings (
    organization_id TEXT PRIMARY KEY,
    usb_mode TEXT NOT NULL DEFAULT 'allow',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

const DEVICE_INSTALL_RESTRICTIONS_KEY =
  "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\DeviceInstall\\Restrictions";
const USB_DISABLE_CLASSES = ["USB", "USBController", "HIDClass", "DiskDrive"];
const USB_DISABLE_INSTANCE_ID_PATTERNS = [
  "^USB\\\\ROOT_HUB",
  "^USB\\\\VID_",
  "^HID\\\\VID_",
  "^USBSTOR\\\\",
];

let configuredUsbMode = null;

const getPoolOrThrow = async () => {
  const pool = getPool();
  await pool.query(TABLE_SQL);
  await pool.query(`
    ALTER TABLE monitor_usb_settings
    ADD COLUMN IF NOT EXISTS usb_mode TEXT NOT NULL DEFAULT 'allow'
  `);
  return pool;
};

const toPublicSettings = (row) =>
  row && {
    usbMode: normalizeUsbMode(row.usb_mode ?? "allow"),
    usbEnabled: normalizeUsbMode(row.usb_mode ?? "allow") === "allow",
    updatedAt: row.updated_at,
  };

const getLocalSettings = async (organizationId) => {
  if (!organizationId) {
    return null;
  }

  const pool = await getPoolOrThrow();
  const result = await pool.query("SELECT * FROM monitor_usb_settings WHERE organization_id = $1", [
    String(organizationId),
  ]);
  const row = result.rows[0] || null;
  return toPublicSettings(row);
};

const saveLocalSettings = async (organizationId, usbModeInput) => {
  const pool = await getPoolOrThrow();
  const usbMode = normalizeUsbMode(usbModeInput);
  const result = await pool.query(
    `
      INSERT INTO monitor_usb_settings (
        organization_id, usb_mode
      )
      VALUES ($1, $2)
      ON CONFLICT (organization_id)
      DO UPDATE SET
        usb_mode = EXCLUDED.usb_mode,
        updated_at = NOW()
      RETURNING *
    `,
    [String(organizationId), usbMode]
  );
  return toPublicSettings(result.rows[0]);
};

const runReg = async (args) => {
  await execFileAsync("reg", args, { windowsHide: true });
};

const runPowerShell = async (script) => {
  const shell = process.env.SystemRoot ? "powershell.exe" : "powershell.exe";
  await execFileAsync(shell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    windowsHide: true,
  });
};

const setUsbStorageEnabled = async (enabled) => {
  await runReg([
    "add",
    "HKLM\\SYSTEM\\CurrentControlSet\\Services\\USBSTOR",
    "/v",
    "Start",
    "/t",
    "REG_DWORD",
    "/d",
    enabled ? "3" : "4",
    "/f",
  ]);
};

const setUsbInstallRestriction = async (key, valueName, enabled) => {
  if (enabled) {
    await runReg([
      "add",
      key,
      "/v",
      valueName,
      "/t",
      "REG_DWORD",
      "/d",
      "1",
      "/f",
    ]);
    return;
  }

  try {
    await runReg(["delete", key, "/v", valueName, "/f"]);
  } catch {
    // The value may not exist yet; keep the mode change best-effort.
  }
};

const setUsbHardwareState = async (enabled) => {
  const action = enabled ? "Enable-PnpDevice" : "Disable-PnpDevice";
  const classFilter = USB_DISABLE_CLASSES.map((item) => `'${item}'`).join(", ");
  const instanceIdFilter = USB_DISABLE_INSTANCE_ID_PATTERNS.map((item) => `($device.InstanceId -match '${item}')`).join(" -or ");
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$devices = Get-PnpDevice -PresentOnly:$false | Where-Object {
  $null -ne $_.Class -and (
    @(${classFilter}) -contains $_.Class -or
    (${instanceIdFilter})
  )
}
foreach ($device in $devices) {
  try {
    ${action} -InstanceId $device.InstanceId -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
  } catch {
  }
}
`;
  await runPowerShell(script);
};

const applyUsbControlPolicy = async (usbModeInput, { force = false } = {}) => {
  const usbMode = normalizeUsbMode(usbModeInput);
  const changed = configuredUsbMode !== usbMode;

  if (process.platform !== "win32") {
    configuredUsbMode = usbMode;
    return {
      supported: false,
      applied: false,
      changed,
      usbMode,
      usbEnabled: usbMode === "allow",
    };
  }

  if (!force && !changed) {
    return {
      supported: true,
      applied: false,
      changed: false,
      usbMode,
      usbEnabled: usbMode === "allow",
    };
  }

  try {
    if (usbMode === "allow") {
      await setUsbStorageEnabled(true);
      await setUsbHardwareState(true);
      await setUsbInstallRestriction(DEVICE_INSTALL_RESTRICTIONS_KEY, "DenyRemovableDevices", false);
      await setUsbInstallRestriction(DEVICE_INSTALL_RESTRICTIONS_KEY, "DenyUnspecified", false);
    } else if (usbMode === "block_storage") {
      await setUsbStorageEnabled(false);
      await setUsbHardwareState(true);
      await setUsbInstallRestriction(DEVICE_INSTALL_RESTRICTIONS_KEY, "DenyRemovableDevices", false);
      await setUsbInstallRestriction(DEVICE_INSTALL_RESTRICTIONS_KEY, "DenyUnspecified", false);
    } else {
      await setUsbStorageEnabled(false);
      await setUsbHardwareState(false);
      await setUsbInstallRestriction(DEVICE_INSTALL_RESTRICTIONS_KEY, "DenyRemovableDevices", true);
      await setUsbInstallRestriction(DEVICE_INSTALL_RESTRICTIONS_KEY, "DenyUnspecified", true);
    }

    configuredUsbMode = usbMode;
    return {
      supported: true,
      applied: true,
      changed: true,
      usbMode,
      usbEnabled: usbMode === "allow",
      enforcement: usbMode === "block_all" ? "hardware_disable_plus_restrictions" : usbMode === "block_storage" ? "storage_only" : "allow",
    };
  } catch (error) {
    return {
      supported: true,
      applied: false,
      changed: true,
      usbMode,
      usbEnabled: usbMode === "allow",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const resolveRemoteUsbMode = (remoteSettings) =>
  remoteSettings?.usbMode ??
  remoteSettings?.settings?.usbMode ??
  (remoteSettings?.usbEnabled === false ? "block_all" : remoteSettings?.usbEnabled === true ? "allow" : null) ??
  (remoteSettings?.settings?.usbEnabled === false ? "block_all" : remoteSettings?.settings?.usbEnabled === true ? "allow" : null);

const resolveUsbControlSettings = async ({ auth, refresh = true } = {}) => {
  const organizationId = auth?.organizationId || null;
  const token = auth?.token || "";
  const localSettings = await getLocalSettings(organizationId);

  let resolvedSettings = localSettings;

  if (token && refresh) {
    try {
      const remoteSettings = await resolveUsbSettingsFromRigweda({ token });
      resolvedSettings = await saveLocalSettings(organizationId, resolveRemoteUsbMode(remoteSettings) ?? "allow");
    } catch {
      resolvedSettings = localSettings;
    }
  }

  if (!resolvedSettings) {
    resolvedSettings = getUsbSettingsFallback();
  }

  const appliedOnDevice = await applyUsbControlPolicy(resolvedSettings.usbMode, { force: true });
  return {
    ...resolvedSettings,
    appliedOnDevice,
  };
};

export const usbControlService = {
  async getSettings({ auth, refresh = true } = {}) {
    return resolveUsbControlSettings({ auth, refresh });
  },

  async saveSettings({ auth, usbMode, usbEnabled }) {
    const organizationId = auth?.organizationId || null;
    const settings = await saveLocalSettings(organizationId, usbMode ?? usbEnabled);
    const appliedOnDevice = await applyUsbControlPolicy(settings.usbMode, { force: true });
    return {
      ...settings,
      appliedOnDevice,
    };
  },
};
