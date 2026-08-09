import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/useAuth";
import { getIsSuperAdmin } from "@/utils/auth";

const RoleBasedHome = () => {
  const token = sessionStorage.getItem("token");
  const { hasAnyPermission, permissions, profile } = useAuth();
  const isSuperAdmin = getIsSuperAdmin();

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (isSuperAdmin) {
    return <Navigate to="/superadmin" replace />;
  }

  const activeRoleSlug = profile?.activeRole?.slug;
  if (!activeRoleSlug && permissions.length === 0) {
    return <Navigate to="/complete-profile" replace />;
  }

  if (activeRoleSlug === "employee") {
    return <Navigate to="/employee-dashboard" replace />;
  }

  const isAdmin = hasAnyPermission([
    "EMP_VIEW",
    "ROLE_VIEW",
    "PERMISSION_VIEW",
    "LEAVE_VIEW_ALL",
    "TIMESHEET_VIEW_ALL",
    "ORG_VIEW"
  ]);

  return <Navigate to={isAdmin ? "/dashboard" : "/employee-dashboard"} replace />;
};

export default RoleBasedHome;
