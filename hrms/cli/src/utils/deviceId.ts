import { NativeModules, Platform } from 'react-native';

type SessionStorageNativeModule = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

const DEVICE_ID_KEY = 'upanaya-device-id';

const sessionStorageModule = NativeModules.SessionStorage as
  | SessionStorageNativeModule
  | undefined;

const isStorageAvailable = () =>
  Platform.OS === 'android' && sessionStorageModule != null;

const generateDeviceId = () => {
  const webCrypto = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }
  return `device-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
};

export const getDeviceId = async () => {
  if (!isStorageAvailable()) {
    return generateDeviceId();
  }

  try {
    const stored = await sessionStorageModule!.getItem(DEVICE_ID_KEY);
    if (stored && stored.trim()) {
      return stored.trim();
    }
    const nextDeviceId = generateDeviceId();
    await sessionStorageModule!.setItem(DEVICE_ID_KEY, nextDeviceId);
    return nextDeviceId;
  } catch {
    return generateDeviceId();
  }
};
