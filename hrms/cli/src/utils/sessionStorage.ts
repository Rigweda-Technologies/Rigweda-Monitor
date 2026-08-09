import { NativeModules, Platform } from 'react-native';
import type { SessionPayload } from '../context/AuthContext';

type SessionStorageNativeModule = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

const SESSION_STORAGE_KEY = 'upanaya-session';

const sessionStorageModule = NativeModules.SessionStorage as
  | SessionStorageNativeModule
  | undefined;

const isStorageAvailable = () =>
  Platform.OS === 'android' && sessionStorageModule != null;

export const loadStoredSession = async (): Promise<SessionPayload | null> => {
  if (!isStorageAvailable()) {
    return null;
  }

  try {
    const rawSession = await sessionStorageModule!.getItem(SESSION_STORAGE_KEY);
    if (!rawSession) {
      return null;
    }

    return JSON.parse(rawSession) as SessionPayload;
  } catch {
    return null;
  }
};

export const storeSession = async (session: SessionPayload) => {
  if (!isStorageAvailable()) {
    return;
  }

  try {
    await sessionStorageModule!.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify(session)
    );
  } catch {
    // Ignore storage failures and continue with in-memory session.
  }
};

export const clearStoredSession = async () => {
  if (!isStorageAvailable()) {
    return;
  }

  try {
    await sessionStorageModule!.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
};
