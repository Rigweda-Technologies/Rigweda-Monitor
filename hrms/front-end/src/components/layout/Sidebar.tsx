import { memo, useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Users,
  Building2,
  Settings,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  FileText,
  UserCircle,
  Shield,
  Building,
  Briefcase,
  CalendarDays,
  CalendarOff,
  ClipboardCheck,
  Network
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/context/useAuth";

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  to: string;
  collapsed: boolean;
  onNavigate?: () => void;
  children?: {
    icon: React.ReactNode;
    label: string;
    to: string;
    permissions?: string[];
  }[];
}

interface MenuItem {
  icon: React.ReactNode;
  label: string;
  to: string;
  permissions?: string[];
  children?: {
    icon: React.ReactNode;
    label: string;
    to: string;
    permissions?: string[];
  }[];
}

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

const NavItem = ({ icon, label, to, collapsed, children, onNavigate }: NavItemProps) => {
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const hasChildren = Boolean(children?.length);
  const isSelfActive = location.pathname === to || (!hasChildren && location.pathname.startsWith(to + "/"));
  const isChildActive = Boolean(
    children?.some(
      (child) =>
        location.pathname === child.to || location.pathname.startsWith(child.to + "/")
    )
  );
  const isActive = isSelfActive || isChildActive;

  useEffect(() => {
    if (hasChildren && isActive) {
      setOpen(true);
    }
  }, [hasChildren, isActive]);

  return (
    <div>
      <div
        className={cn(
          "group flex items-center justify-between rounded-xl border border-transparent transition-all duration-300",
          "hover:border-white/15 hover:bg-white/10",
          isActive && "border-white/20 bg-white/16 text-white shadow-[0_8px_24px_-14px_rgba(2,6,23,0.9)]"
        )}
        onClick={() => hasChildren && setOpen(!open)}
      >
        <NavLink
          to={hasChildren ? "#" : to}
          className={cn(
            "flex w-full items-center gap-3 px-4 py-3 text-white/85 transition-colors",
            isActive && "text-white font-medium"
          )}
          onClick={() => {
            if (!hasChildren) onNavigate?.();
          }}
        >
          <span className={cn("h-5 w-5 transition-colors", isActive ? "text-white" : "text-white/85")}>{icon}</span>
          {!collapsed && <span>{label}</span>}
        </NavLink>

        {!collapsed && hasChildren && (
          <ChevronRight
            size={16}
            className={cn("mr-3 text-white/70 transition-transform duration-300", open && "rotate-90")}
          />
        )}
      </div>

      <AnimatePresence initial={false}>
        {!collapsed && open && hasChildren && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -10 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -10 }}
            transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="ml-4 mt-2 space-y-1 border-l border-white/12 pl-3">
              {children?.map((child) => (
                <NavLink key={child.to} to={child.to} onClick={onNavigate} className="block">
                  <div
                    className={cn(
                      "flex items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-sm text-white/80 transition-all duration-300",
                      "hover:border-white/14 hover:bg-white/10 hover:text-white",
                      location.pathname === child.to && "border-white/20 bg-white/16 text-white font-medium shadow-[0_8px_20px_-16px_rgba(2,6,23,1)]"
                    )}
                  >
                    {child.icon}
                    <span>{child.label}</span>
                  </div>
                </NavLink>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const menuItems = (dashboardPath: string): MenuItem[] => [
  { icon: <LayoutDashboard size={20} />, label: "Dashboard", to: dashboardPath },
  {
    icon: <Users size={20} />,
    label: "Employees",
    to: "/employees",
    permissions: ["EMP_VIEW"],
    children: [
      { icon: <Users size={18} />, label: "Employee", to: "/employees", permissions: ["EMP_VIEW"] },
      { icon: <ClipboardCheck size={18} />, label: "Attendance", to: "/attendance", permissions: ["ATTENDANCE_VIEW_ALL", "ATTENDANCE_VIEW_SELF"] },
      { icon: <FileText size={18} />, label: "Timesheets", to: "/timesheets", permissions: ["TIMESHEET_VIEW_SELF", "TIMESHEET_VIEW_ALL"] },
      { icon: <CalendarOff size={18} />, label: "Leave", to: "/leave", permissions: ["LEAVE_VIEW_SELF", "LEAVE_VIEW_ALL", "LEAVE_APPLY"] },
      { icon: <FileText size={18} />, label: "Payslips", to: "/employee-dashboard/payslips", permissions: ["EMP_SELF_VIEW"] },
      { icon: <Shield size={18} />, label: "Approvals", to: "/approvals", permissions: ["LEAVE_ACTION", "ATTENDANCE_MANAGE"] },
      { icon: <CalendarDays size={20} />, label: "Holidays", to: "/holidays", permissions: ["HOLIDAY_VIEW"] },
      { icon: <Network size={18} />, label: "Organization Tree", to: "/employee-tree", permissions: ["EMP_VIEW", "EMP_ORG_TREE_VIEW"] }
    ]
  },
  {
    icon: <Building size={20} />,
    label: "Organization",
    to: "/organization",
    permissions: ["ORG_VIEW", "ROLE_VIEW", "PERMISSION_VIEW", "DEPT_VIEW", "DESIG_VIEW", "LEAVE_TYPE_VIEW", "ORG_DOCUMENT_VIEW"],
    children: [
      { icon: <Shield size={18} />, label: "Roles", to: "/roles", permissions: ["ROLE_VIEW"] },
      { icon: <Shield size={18} />, label: "Permissions", to: "/permissions", permissions: ["PERMISSION_VIEW"] },
      { icon: <Building2 size={18} />, label: "Departments", to: "/departments", permissions: ["DEPT_VIEW"] },
      { icon: <Briefcase size={18} />, label: "Designations", to: "/designations", permissions: ["DESIG_VIEW"] },
      { icon: <CalendarDays size={18} />, label: "Shifts", to: "/shifts", permissions: ["SHIFT_VIEW"] },
      { icon: <CalendarOff size={18} />, label: "Week Offs", to: "/week-offs", permissions: ["WEEK_OFF_VIEW"] },
      { icon: <FileText size={18} />, label: "Leave Types", to: "/leave-types", permissions: ["LEAVE_TYPE_VIEW"] },
      { icon: <ClipboardCheck size={18} />, label: "Approval Flows", to: "/approval-flows", permissions: ["APPROVAL_FLOW_VIEW"] },
      { icon: <DollarSign size={18} />, label: "Expenses", to: "/expenses", permissions: ["EXPENSE_VIEW", "EXPENSE_MANAGE"] },
      { icon: <FileText size={18} />, label: "Documents", to: "/organization/documents", permissions: ["ORG_DOCUMENT_VIEW", "ORG_SETTINGS_VIEW", "PAYROLL_REPORT_VIEW"] },
    ]
  },
  {
    icon: <Settings size={20} />,
    label: "Settings",
    to: "/organization/settings",
    permissions: ["ORG_SETTINGS_VIEW"]
  },
  {
    icon: <DollarSign size={20} />,
    label: "Payroll",
    to: "/payroll",
    permissions: [
      "PAYROLL_CONFIG_MANAGE",
      "PAYROLL_RUN_CREATE",
      "PAYROLL_RUN_APPROVE",
      "PAYROLL_RUN_LOCK",
      "PAYROLL_REPORT_VIEW",
      "PAYROLL_PAYSLIP_VIEW",
      "PAYROLL_RUN_VIEW"
    ],
    children: [
      {
        icon: <DollarSign size={18} />,
        label: "Setup",
        to: "/payroll/setup",
        permissions: [
          "PAYROLL_CONFIG_MANAGE",
          "PAYROLL_RUN_CREATE",
          "PAYROLL_RUN_APPROVE",
          "PAYROLL_RUN_LOCK",
          "PAYROLL_REPORT_VIEW",
          "PAYROLL_PAYSLIP_VIEW",
          "PAYROLL_RUN_VIEW"
        ]
      },
      {
        icon: <Users size={18} />,
        label: "Employees",
        to: "/payroll/employees",
        permissions: [
          "PAYROLL_CONFIG_MANAGE",
          "PAYROLL_RUN_CREATE",
          "PAYROLL_RUN_APPROVE",
          "PAYROLL_RUN_LOCK",
          "PAYROLL_REPORT_VIEW",
          "PAYROLL_PAYSLIP_VIEW",
          "PAYROLL_RUN_VIEW"
        ]
      },
      {
        icon: <DollarSign size={18} />,
        label: "Runs",
        to: "/payroll/runs",
        permissions: [
          "PAYROLL_CONFIG_MANAGE",
          "PAYROLL_RUN_CREATE",
          "PAYROLL_RUN_APPROVE",
          "PAYROLL_RUN_LOCK",
          "PAYROLL_REPORT_VIEW",
          "PAYROLL_PAYSLIP_VIEW",
          "PAYROLL_RUN_VIEW"
        ]
      },
      {
        icon: <Users size={18} />,
        label: "Breakdown",
        to: "/payroll/employee-breakdown",
        permissions: [
          "PAYROLL_RUN_VIEW",
          "PAYROLL_REPORT_VIEW",
          "PAYROLL_RUN_CREATE",
          "PAYROLL_RUN_APPROVE",
          "PAYROLL_RUN_LOCK"
        ]
      }
    ]
  },
  {
    icon: <DollarSign size={20} />,
    label: "Business",
    to: "/business-development",
    permissions: ["PROJECT_VIEW", "PROJECT_MANAGE", "HIRING_VIEW", "HIRING_MANAGE"],
    children: [
      {
        icon: <Briefcase size={18} />,
        label: "Projects",
        to: "/business-development",
        permissions: ["PROJECT_VIEW", "PROJECT_MANAGE"]
      },
      {
        icon: <Users size={18} />,
        label: "Hiring",
        to: "/hiring",
        permissions: ["HIRING_VIEW", "HIRING_MANAGE"]
      }
    ]
  },
  { icon: <FileText size={20} />, label: "Guidelines", to: "/documentation", permissions: ["EMP_VIEW", "EMP_SELF_VIEW", "EMP_CREATE", "EMP_UPDATE"] }
];

export const Sidebar = memo(({
  mobileOpen = false,
  onMobileClose,
  collapsed: controlledCollapsed,
  onCollapsedChange
}: SidebarProps) => {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const { profile, hasAnyPermission, isSuperAdmin } = useAuth();
  const collapsed = controlledCollapsed ?? internalCollapsed;
  const effectiveCollapsed = collapsed && !hoverExpanded;

  const setCollapsed = (next: boolean) => {
    if (controlledCollapsed === undefined) {
      setInternalCollapsed(next);
    }
    onCollapsedChange?.(next);
  };

  useEffect(() => {
    const updateMobile = () => setIsMobile(window.innerWidth < 1024);
    updateMobile();
    window.addEventListener("resize", updateMobile);
    return () => window.removeEventListener("resize", updateMobile);
  }, []);

  const isEmployeeRole = profile?.activeRole?.slug === "employee";
  const dashboardPath = isEmployeeRole
    ? "/employee-dashboard"
    : hasAnyPermission([
        "EMP_VIEW",
        "ROLE_VIEW",
        "PERMISSION_VIEW",
        "LEAVE_VIEW_ALL",
        "TIMESHEET_VIEW_ALL",
        "ORG_VIEW"
      ])
      ? "/dashboard"
      : "/employee-dashboard";

  const effectiveDashboardPath = isSuperAdmin ? "/superadmin" : dashboardPath;
  const allowedPathsForEmployee = useMemo(
    () =>
      new Set([
        "/",
        "/employee-dashboard",
        "/attendance",
        "/leave",
        "/timesheets",
        "/employee-dashboard/payslips",
        "/holidays",
        "/documentation",
        "/employee-tree"
      ]),
    []
  );

  const filteredMenuItems: MenuItem[] = useMemo(() => menuItems(effectiveDashboardPath)
    .map((item) => {
      if (item.children) {
        const filteredChildren = item.children.filter((child) => {
          if (isEmployeeRole) return allowedPathsForEmployee.has(child.to);
          return !child.permissions || hasAnyPermission(child.permissions);
        });
        if (filteredChildren.length === 0) return null;
        return {
          ...item,
          permissions: isEmployeeRole ? undefined : item.permissions,
          children: filteredChildren
        };
      }

      if (isEmployeeRole && !allowedPathsForEmployee.has(item.to)) return null;
      return isEmployeeRole ? { ...item, permissions: undefined } : item;
    })
    .filter(
      (item): item is MenuItem =>
        Boolean(item) && (!item.permissions || hasAnyPermission(item.permissions))
    ), [allowedPathsForEmployee, effectiveDashboardPath, hasAnyPermission, isEmployeeRole]);

  return (
    <>
      {isMobile && mobileOpen && (
        <button
          type="button"
          aria-label="Close sidebar overlay"
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={onMobileClose}
        />
      )}

      <motion.aside
        className={cn(
          "sidebar-gradient h-screen fixed left-0 top-0 z-50 flex flex-col transition-transform lg:translate-x-0",
          isMobile ? (mobileOpen ? "translate-x-0" : "-translate-x-full") : "translate-x-0"
        )}
        initial={false}
        animate={{ width: effectiveCollapsed ? 72 : 260 }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        onMouseEnter={() => {
          if (!isMobile && collapsed) setHoverExpanded(true);
        }}
        onMouseLeave={() => {
          if (!isMobile) setHoverExpanded(false);
        }}
      >
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center justify-between">
            <NavLink
              to={effectiveDashboardPath}
              onClick={() => isMobile && onMobileClose?.()}
              className="flex items-center gap-3 px-1 py-1"
            >
              <div className="w-14 h-14 rounded-xl bg-white/8 border border-white/15 flex items-center justify-center overflow-hidden">
                <img src="/hrms-logo.png" alt="Upanaya logo" className="w-10 h-10 object-contain" />
              </div>
              <AnimatePresence>
                {!effectiveCollapsed && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-white font-bold text-xl"
                  >
                    HRMS
                  </motion.div>
                )}
              </AnimatePresence>
            </NavLink>
            {!effectiveCollapsed && (
              <button
                onClick={() => setCollapsed(!collapsed)}
                disabled={isMobile}
                className="w-8 h-8 rounded-lg border border-white/12 bg-white/10 hover:bg-white/18 disabled:opacity-50 flex items-center justify-center text-white transition-all"
              >
                {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              </button>
            )}
          </div>
        </div>

        <nav className="flex-1 py-4 px-3 overflow-y-auto scroll-smooth custom-scroll">
          <div className="space-y-1">
            {filteredMenuItems.map((item) => (
              <NavItem
                key={item.to}
                {...item}
                collapsed={effectiveCollapsed}
                onNavigate={() => isMobile && onMobileClose?.()}
              />
            ))}
          </div>
        </nav>

        {/* <div className="border-t border-white/10 py-4 px-3">
          <div className="mt-4 pt-4 border-t border-white/10">
            <div className="flex items-center gap-3 px-2">
              <Avatar className="w-10 h-10 border-2 border-white/30">
                <AvatarImage src={profile?.profileImage || undefined} />
                <AvatarFallback className="bg-white/20 text-white">JD</AvatarFallback>
              </Avatar>
              <AnimatePresence>
                {!effectiveCollapsed && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <p className="text-white font-medium text-sm truncate">
                      {profile?.firstName || profile?.lastName
                        ? `${profile?.firstName || ""} ${profile?.lastName || ""}`.trim()
                        : profile?.email || "User"}
                    </p>
                    <p className="text-white/60 text-xs truncate">
                      {profile?.activeRole?.name || "Role"}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div> */}
      </motion.aside>
    </>
  );
});

Sidebar.displayName = "Sidebar";
