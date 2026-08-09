import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getApiWithToken } from '../services/api';
import {
  clearStoredSession,
  loadStoredSession,
  storeSession,
} from '../utils/sessionStorage';

export type SessionPayload = {
  token: string;
  loginData: any;
  profile: any | null;
  permissions: string[];
};

type AuthContextValue = {
  session: SessionPayload | null;
  setSession: (payload: SessionPayload | null) => void;
  updateProfile: (profile: any | null) => void;
  updatePermissions: (permissions: string[]) => void;
  updateToken: (token: string) => void;
  refreshPermissions: () => Promise<string[]>;
  logout: () => void;
  sessionExpiredMessage: string | null;
  setSessionExpiredMessage: (message: string | null) => void;
  clearSessionExpiredMessage: () => void;
  loginSuccessMessage: string | null;
  setLoginSuccessMessage: (message: string | null) => void;
  clearLoginSuccessMessage: () => void;
  logoutSuccessMessage: string | null;
  setLogoutSuccessMessage: (message: string | null) => void;
  clearLogoutSuccessMessage: () => void;
  authReady: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const normalizePermissions = (permissions: any): string[] => {
  if (!Array.isArray(permissions)) {
    return [];
  }

  return Array.from(
    new Set(
      permissions
        .map((permission) => {
      if (typeof permission === 'string') {
        return permission.trim();
      }
      if (permission && typeof permission === 'object') {
        const code = permission.code || permission.slug || permission.name || '';
        return typeof code === 'string' ? code.trim() : '';
      }
      return '';
        })
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSessionState] = useState<SessionPayload | null>(null);
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState<string | null>(null);
  const [loginSuccessMessage, setLoginSuccessMessage] = useState<string | null>(null);
  const [logoutSuccessMessage, setLogoutSuccessMessage] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const hydrateSession = async () => {
      const storedSession = await loadStoredSession();

      if (!isMounted) {
        return;
      }

      setSessionState(storedSession);
      setAuthReady(true);
    };

    void hydrateSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const setSession = useCallback((payload: SessionPayload | null) => {
    const normalizedPayload = payload
      ? { ...payload, permissions: normalizePermissions(payload.permissions) }
      : null;
    setSessionState(normalizedPayload);

    if (normalizedPayload) {
      void storeSession(normalizedPayload);
      return;
    }

    void clearStoredSession();
  }, []);

  const updateProfile = (profile: any | null) => {
    setSessionState((current) => {
      if (!current) {
        return current;
      }

      const nextSession = { ...current, profile };
      void storeSession(nextSession);
      return nextSession;
    });
  };

  const updatePermissions = (permissions: string[]) => {
    setSessionState((current) => {
      if (!current) {
        return current;
      }

      const nextSession = { ...current, permissions: normalizePermissions(permissions) };
      void storeSession(nextSession);
      return nextSession;
    });
  };

  const updateToken = (token: string) => {
    setSessionState((current) => {
      if (!current) {
        return current;
      }

      const nextSession = { ...current, token };
      void storeSession(nextSession);
      return nextSession;
    });
  };

  const refreshPermissions = useCallback(async () => {
    if (!session?.token) {
      return [];
    }

    const response = await getApiWithToken<any>('/users/me/permissions', session.token);
    const nextPermissions = response?.success ? normalizePermissions(response.data || []) : [];

    setSessionState((current) => {
      if (!current) {
        return current;
      }

      const currentPermissions = normalizePermissions(current.permissions);
      const hasSamePermissions =
        currentPermissions.length === nextPermissions.length &&
        currentPermissions.every((permission, index) => permission === nextPermissions[index]);

      if (hasSamePermissions) {
        return current;
      }

      const nextSession = { ...current, permissions: nextPermissions };
      void storeSession(nextSession);
      return nextSession;
    });

    return nextPermissions;
  }, [session?.token]);

  const logout = useCallback(() => {
    setSession(null);
  }, [setSession]);

  const clearSessionExpiredMessage = () => setSessionExpiredMessage(null);
  const clearLoginSuccessMessage = () => setLoginSuccessMessage(null);
  const clearLogoutSuccessMessage = () => setLogoutSuccessMessage(null);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      setSession,
      updateProfile,
      updatePermissions,
      updateToken,
      refreshPermissions,
      logout,
      sessionExpiredMessage,
      setSessionExpiredMessage,
      clearSessionExpiredMessage,
      loginSuccessMessage,
      setLoginSuccessMessage,
      clearLoginSuccessMessage,
      logoutSuccessMessage,
      setLogoutSuccessMessage,
      clearLogoutSuccessMessage,
      authReady,
    }),
    [
      session,
      setSession,
      sessionExpiredMessage,
      loginSuccessMessage,
      logoutSuccessMessage,
      authReady,
      refreshPermissions,
      logout,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
};
