import { ReactNode } from "react";
import { useAuth } from "@/context/useAuth";

interface PermissionGateProps {
  permissions: string[];
  children: ReactNode;
  fallback?: ReactNode;
}

const PermissionGate = ({ permissions, children, fallback = null }: PermissionGateProps) => {
  const { hasAnyPermission } = useAuth();
  if (!hasAnyPermission(permissions)) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
};

export default PermissionGate;
