import { createContext } from "react";

export type AuthRole = {
  _id?: string;
  slug?: string;
};

export type AuthProfile = {
  activeRole?: AuthRole | null;
  roles?: AuthRole[];
  [key: string]: unknown;
};

export type AuthContextValue = {
  profile: AuthProfile | null;
  permissions: string[];
  isSuperAdmin: boolean;
  setProfile: (profile: AuthProfile | null) => void;
  setPermissions: (permissions: string[]) => void;
  refresh: () => void;
  hasAnyPermission: (codes: string[]) => boolean;
  loadProfile: () => Promise<void>;
  loadPermissions: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
