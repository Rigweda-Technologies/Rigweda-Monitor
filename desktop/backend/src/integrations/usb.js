import { getMonitorUsbSettingsFromRigweda } from "./rigweda-api.js";

const USB_MODES = new Set(["allow", "block_storage", "block_all"]);

const normalizeUsbMode = (value) => {
  if (value && typeof value === "object") {
    return normalizeUsbMode(value.usbMode ?? value.mode ?? value.usbEnabled);
  }

  if (typeof value === "boolean") {
    return value ? "allow" : "block_all";
  }

  const normalized = String(value || "").trim().toLowerCase();
  if (USB_MODES.has(normalized)) {
    return normalized;
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return "allow";
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return "block_all";
  }

  return "allow";
};

export const resolveUsbSettingsFromRigweda = async ({ token }) => {
  const response = await getMonitorUsbSettingsFromRigweda({ token });
  return response;
};

export const getUsbSettingsFallback = () => {
  const usbMode = normalizeUsbMode(process.env.USB_MODE || process.env.USB_ENABLED || "");

  return {
    usbMode,
    usbEnabled: usbMode === "allow",
  };
};

export { normalizeUsbMode };
