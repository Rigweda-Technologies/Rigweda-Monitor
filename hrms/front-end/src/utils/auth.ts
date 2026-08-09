// src/utils/auth.ts

export type ActiveRole = {
  roleId: number;
  roleName: string;
  homePage: string;
};

export type Profile = {
  email: string;
  firstName: string;
  lastName: string;
  profileImage?: string;
  activeRole: ActiveRole;
  availableRoles: ActiveRole[];
};

const STORAGE_KEYS = {
  token: "token",
  profile: "profile",
  userProfile: "userProfile",
  permissions: "permissions",
  isSuperAdmin: "isSuperAdmin",
  adminUserId: "adminUserId",
  adminRoleId: "adminRoleId",
  sharedSession: "auth:shared-session"
} as const;

type SharedSessionSnapshot = {
  token: string | null;
  profile: Profile | null;
  userProfile: any | null;
  permissions: string[];
  isSuperAdmin: boolean;
  adminUserId: string | null;
  adminRoleId: string | null;
};

const readSessionValue = <T>(key: string, fallback: T): T => {
  try {
    const data = sessionStorage.getItem(key);
    return data ? JSON.parse(data) as T : fallback;
  } catch {
    return fallback;
  }
};

const writeSessionValue = (key: string, value: unknown) => {
  sessionStorage.setItem(key, JSON.stringify(value));
};

const readSharedSession = (): SharedSessionSnapshot | null => {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.sharedSession);
    return data ? JSON.parse(data) as SharedSessionSnapshot : null;
  } catch {
    return null;
  }
};

const writeSharedSession = (patch: Partial<SharedSessionSnapshot>) => {
  const current = readSharedSession() || {
    token: null,
    profile: null,
    userProfile: null,
    permissions: [],
    isSuperAdmin: false,
    adminUserId: null,
    adminRoleId: null
  };

  localStorage.setItem(
    STORAGE_KEYS.sharedSession,
    JSON.stringify({
      ...current,
      ...patch
    })
  );
};

const syncSharedSessionFromCurrentTab = () => {
  const token = sessionStorage.getItem(STORAGE_KEYS.token);
  if (!token) return;

  writeSharedSession({
    token,
    profile: readSessionValue<Profile | null>(STORAGE_KEYS.profile, null),
    userProfile: readSessionValue<any | null>(STORAGE_KEYS.userProfile, null),
    permissions: readSessionValue<string[]>(STORAGE_KEYS.permissions, []),
    isSuperAdmin: sessionStorage.getItem(STORAGE_KEYS.isSuperAdmin) === "true",
    adminUserId: sessionStorage.getItem(STORAGE_KEYS.adminUserId),
    adminRoleId: sessionStorage.getItem(STORAGE_KEYS.adminRoleId)
  });
};

export const hydrateSessionFromSharedSession = (): boolean => {
  if (sessionStorage.getItem(STORAGE_KEYS.token)) return true;

  const shared = readSharedSession();
  if (!shared?.token) return false;

  sessionStorage.setItem(STORAGE_KEYS.token, shared.token);
  if (shared.profile) writeSessionValue(STORAGE_KEYS.profile, shared.profile);
  if (shared.userProfile) writeSessionValue(STORAGE_KEYS.userProfile, shared.userProfile);
  writeSessionValue(STORAGE_KEYS.permissions, shared.permissions || []);
  sessionStorage.setItem(STORAGE_KEYS.isSuperAdmin, shared.isSuperAdmin ? "true" : "false");

  if (shared.adminUserId) sessionStorage.setItem(STORAGE_KEYS.adminUserId, shared.adminUserId);
  if (shared.adminRoleId) sessionStorage.setItem(STORAGE_KEYS.adminRoleId, shared.adminRoleId);

  return true;
};

const ensureHydrated = () => {
  if (sessionStorage.getItem(STORAGE_KEYS.token)) {
    syncSharedSessionFromCurrentTab();
    return;
  }
  hydrateSessionFromSharedSession();
};

export const getProfile = (): Profile | null => {
  ensureHydrated();
  return readSessionValue<Profile | null>(STORAGE_KEYS.profile, null);
};

export const setProfile = (profile: Profile) => {
  writeSessionValue(STORAGE_KEYS.profile, profile);
  writeSharedSession({ profile });
};

export const getToken = (): string | null => {
  ensureHydrated();
  return sessionStorage.getItem(STORAGE_KEYS.token);
};

export const setToken = (token: string) => {
  sessionStorage.setItem(STORAGE_KEYS.token, token);
  writeSharedSession({ token });
};

export const clearAuth = () => {
  sessionStorage.removeItem(STORAGE_KEYS.profile);
  sessionStorage.removeItem(STORAGE_KEYS.permissions);
  sessionStorage.removeItem(STORAGE_KEYS.userProfile);
  sessionStorage.removeItem(STORAGE_KEYS.token);
  sessionStorage.removeItem(STORAGE_KEYS.isSuperAdmin);
  sessionStorage.removeItem(STORAGE_KEYS.adminUserId);
  sessionStorage.removeItem(STORAGE_KEYS.adminRoleId);

  localStorage.removeItem(STORAGE_KEYS.sharedSession);
  localStorage.removeItem(STORAGE_KEYS.profile);
  localStorage.removeItem(STORAGE_KEYS.permissions);
  localStorage.removeItem(STORAGE_KEYS.userProfile);
  localStorage.removeItem(STORAGE_KEYS.isSuperAdmin);
  localStorage.removeItem(STORAGE_KEYS.adminUserId);
  localStorage.removeItem(STORAGE_KEYS.adminRoleId);
};

export const getUserProfile = (): any | null => {
  ensureHydrated();
  return readSessionValue<any | null>(STORAGE_KEYS.userProfile, null);
};

export const setUserProfile = (profile: any) => {
  writeSessionValue(STORAGE_KEYS.userProfile, profile);
  writeSharedSession({ userProfile: profile });
};

export const getActiveRoleFromProfile = (): any | null => {
  const profile = getUserProfile();
  return profile?.activeRole || profile?.roles?.[0] || null;
};

export const updateActiveRoleInProfile = (role: any) => {
  const profile = getUserProfile();
  if (!profile) return;
  profile.activeRole = role;
  setUserProfile(profile);
};

export const getActiveRole = (): ActiveRole | null => {
  return getProfile()?.activeRole || null;
};

export const getActiveRoleId = (): number | null => {
  return getProfile()?.activeRole?.roleId ?? null;
};

export const hasRole = (allowedRoles: number[]): boolean => {
  const roleId = getActiveRoleId();
  return roleId !== null && allowedRoles.includes(roleId);
};

export const setPermissions = (permissions: string[]) => {
  writeSessionValue(STORAGE_KEYS.permissions, permissions || []);
  writeSharedSession({ permissions: permissions || [] });
};

export const getPermissions = (): string[] => {
  ensureHydrated();
  return readSessionValue<string[]>(STORAGE_KEYS.permissions, []);
};

export const hasPermission = (code: string): boolean => {
  const permissions = getPermissions();
  if (permissions.includes("*")) return true;
  return permissions.includes(code);
};

export const hasAnyPermission = (codes: string[]): boolean => {
  if (!codes || codes.length === 0) return true;
  return codes.some((code) => hasPermission(code));
};

export const getActiveRoleIdFromProfile = (): string | null => {
  const active = getActiveRoleFromProfile();
  return active?._id || null;
};

export const getIsSuperAdmin = (): boolean => {
  ensureHydrated();
  return sessionStorage.getItem(STORAGE_KEYS.isSuperAdmin) === "true";
};

export const setIsSuperAdmin = (value: boolean) => {
  sessionStorage.setItem(STORAGE_KEYS.isSuperAdmin, value ? "true" : "false");
  writeSharedSession({ isSuperAdmin: value });
};

export const getAdminUserId = (): string | null => {
  ensureHydrated();
  return sessionStorage.getItem(STORAGE_KEYS.adminUserId);
};

export const setAdminUserId = (value: string | null) => {
  if (value) sessionStorage.setItem(STORAGE_KEYS.adminUserId, value);
  else sessionStorage.removeItem(STORAGE_KEYS.adminUserId);
  writeSharedSession({ adminUserId: value });
};

export const getAdminRoleId = (): string | null => {
  ensureHydrated();
  return sessionStorage.getItem(STORAGE_KEYS.adminRoleId);
};

export const setAdminRoleId = (value: string | null) => {
  if (value) sessionStorage.setItem(STORAGE_KEYS.adminRoleId, value);
  else sessionStorage.removeItem(STORAGE_KEYS.adminRoleId);
  writeSharedSession({ adminRoleId: value });
};
