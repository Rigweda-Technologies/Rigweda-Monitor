import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/useAuth";

interface RequireAuthProps {
  children: JSX.Element;
  permissions?: string[];
}

const RequireAuth = ({ children, permissions }: RequireAuthProps) => {
  const location = useLocation();
  const token = sessionStorage.getItem("token");
  const { hasAnyPermission, profile } = useAuth();

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (
    profile?.mustChangePassword &&
    location.pathname !== "/change-password"
  ) {
    return <Navigate to="/change-password" replace />;
  }

  if (permissions && permissions.length > 0 && !hasAnyPermission(permissions)) {
    return <Navigate to="/not-found" replace />;
  }

  return children;
};

export default RequireAuth;
