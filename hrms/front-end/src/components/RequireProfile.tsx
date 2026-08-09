import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getApiWithToken } from "@/services/apiWrapper";
import { useAuth } from "@/context/useAuth";
import { PageLoader } from "@/components/ui/loaders";

interface RequireProfileProps {
  children: JSX.Element;
}

const RequireProfile = ({ children }: RequireProfileProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const { isSuperAdmin, hasAnyPermission, profile } = useAuth();
  const roleId = profile?.activeRole?._id || "";
  const profileCheckKey = `${location.pathname}:${roleId}:${isSuperAdmin ? "superadmin" : "standard"}`;

  useEffect(() => {
    const run = async () => {
      if (isSuperAdmin) {
        setLoading(false);
        return;
      }

      const roleSlugs = (profile?.roles || [])
        .map((role: any) => String(role?.slug || "").trim().toLowerCase())
        .filter(Boolean);

      const isAdminByRoleSlug = roleSlugs.some((slug) =>
        [
          "org-admin",
          "admin",
          "hr",
          "hr-admin",
          "manager",
          "approver",
          "finance-viewer",
          "auditor",
          "payroll-processor"
        ].includes(slug)
      );

      const isAdminByRole = hasAnyPermission([
        "EMP_VIEW",
        "ROLE_VIEW",
        "PERMISSION_VIEW",
        "LEAVE_VIEW_ALL",
        "TIMESHEET_VIEW_ALL",
        "ORG_VIEW"
      ]);

      if (isAdminByRoleSlug || isAdminByRole) {
        setLoading(false);
        return;
      }

      try {
        const res = await getApiWithToken("/employees/me");
        if (res?.success && res?.data) {
          if (res.data.profileCompleted === false) {
            if (location.pathname !== "/complete-profile") {
              navigate("/complete-profile", { replace: true });
              return;
            }
          }
        } else if (location.pathname !== "/complete-profile") {
          navigate("/complete-profile", { replace: true });
          return;
        }
      } catch {
        if (location.pathname !== "/complete-profile") {
          navigate("/complete-profile", { replace: true });
          return;
        }
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [profileCheckKey, location.pathname, navigate, isSuperAdmin, hasAnyPermission, profile]);

  if (loading) return <PageLoader label="Preparing your workspace..." />;

  return children;
};

export default RequireProfile;
