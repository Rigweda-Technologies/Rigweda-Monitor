import { useCallback, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { getApiWithToken } from "@/services/apiWrapper";
import {
  getIsSuperAdmin,
  getToken,
  getPermissions,
  getUserProfile,
  setPermissions as setPermissionsLocal,
  setUserProfile as setUserProfileLocal,
  setIsSuperAdmin,
} from "@/utils/auth";
import { ApiResponseEnvelope } from "@/services/apiWrapper";
import { AuthContext, AuthProfile } from "@/context/auth-context";

const readIsSuperAdmin = (profile: AuthProfile | null) => {
  if (profile?.activeRole?.slug === "superadmin") return true;
  if (profile?.roles?.some((r) => r?.slug === "superadmin")) return true;
  return getIsSuperAdmin();
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [profile, setProfileState] = useState<AuthProfile | null>(getUserProfile() as AuthProfile | null);
  const [permissions, setPermissionsState] = useState<string[]>(getPermissions());

  const isSuperAdmin = useMemo(() => readIsSuperAdmin(profile), [profile]);

  const setProfile = (nextProfile: AuthProfile | null) => {
    if (nextProfile) {
      setUserProfileLocal(nextProfile);
    } else {
      sessionStorage.removeItem("userProfile");
    }
    setProfileState(nextProfile);

    if (nextProfile?.activeRole?.slug === "superadmin") {
      setIsSuperAdmin(true);
    } else {
      setIsSuperAdmin(false);
    }
  };

  const setPermissions = (nextPermissions: string[]) => {
    setPermissionsLocal(nextPermissions || []);
    setPermissionsState(nextPermissions || []);
  };

  const refresh = () => {
    setProfileState(getUserProfile() as AuthProfile | null);
    setPermissionsState(getPermissions());
  };

  const hasAnyPermission = useCallback((codes: string[]) => {
    if (!codes || codes.length === 0) return true;
    const currentPermissions = getPermissions();
    if (currentPermissions.includes("*")) return true;
    return codes.some((code) => currentPermissions.includes(code));
  }, []);

  const loadProfile = useCallback(async () => {
    try {
      const res = await getApiWithToken("/users/me/profile") as ApiResponseEnvelope<AuthProfile>;
      if (res?.success && res?.data) {
        const current = (getUserProfile() as AuthProfile | null) || {};
        const merged = { ...current, ...res.data };
        setProfile(merged);
      }
    } catch {
      // no-op
    }
  }, []);

  const loadPermissions = useCallback(async () => {
    try {
      const res = await getApiWithToken("/users/me/permissions") as ApiResponseEnvelope<string[]>;
      if (res?.success) {
        setPermissions(res.data || []);
      }
    } catch {
      // no-op
    }
  }, []);

  useEffect(() => {
    const token = getToken();
    if (token) {
      loadProfile();
      loadPermissions();
    }
  }, [loadPermissions, loadProfile]);

  const lastRoleIdRef = useRef<string | null>(null);
  const bootstrappedPermissionsRef = useRef(false);
  useEffect(() => {
    const roleId = profile?.activeRole?._id || null;
    if (!roleId) return;
    if (!bootstrappedPermissionsRef.current) {
      bootstrappedPermissionsRef.current = true;
      lastRoleIdRef.current = roleId;
      return;
    }
    if (roleId !== lastRoleIdRef.current) {
      lastRoleIdRef.current = roleId;
      loadPermissions();
    }
  }, [loadPermissions, profile?.activeRole?._id]);

  return (
    <AuthContext.Provider
      value={{
        profile,
        permissions,
        isSuperAdmin,
        setProfile,
        setPermissions,
        refresh,
        hasAnyPermission,
        loadProfile,
        loadPermissions,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
