const DEVICE_ID_KEY = "upanaya:device-id";

const generateDeviceId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `device-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
};

export const getDeviceId = () => {
  try {
    const stored = localStorage.getItem(DEVICE_ID_KEY);
    if (stored && stored.trim()) {
      return stored.trim();
    }
    const nextDeviceId = generateDeviceId();
    localStorage.setItem(DEVICE_ID_KEY, nextDeviceId);
    return nextDeviceId;
  } catch {
    return generateDeviceId();
  }
};
