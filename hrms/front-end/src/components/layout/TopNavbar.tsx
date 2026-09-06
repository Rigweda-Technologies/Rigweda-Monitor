import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Bell, ChevronDown, Menu, Paintbrush, Save, SlidersHorizontal, FileText, Newspaper, WalletCards, BarChart3 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getApiWithToken, patchApiWithToken, postApiWithToken, switchRole } from "@/services/apiWrapper";
import { clearAuth, setToken, updateActiveRoleInProfile } from "@/utils/auth";
import { useAuth } from "@/context/useAuth";
import { toast } from "sonner";
import { formatDateTimeInOrgTimeZone } from "@/utils/timezone";
import { applyThemeToDocument, THEME_PRESETS, OrgThemeConfig, OrgThemePreset, OrgThemeSettings } from "@/utils/theme";
import {
  RealtimeNotification,
  disconnectRealtimeSocket,
  reconnectRealtimeSocket,
  subscribeNotifications
} from "@/services/attendanceSocket";

interface TopNavbarProps {
  title?: string;
  breadcrumb?: { label: string; href?: string }[];
  onOpenSidebar?: () => void;
}

interface NotificationItem {
  _id: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  type?: string;
  meta?: Record<string, unknown>;
}

type OrgSettingsSnapshot = {
  leaveCreditFrequency?: string;
  leaveTypeCreditMode?: string;
  sandwichRuleEnabled?: boolean;
  attendanceLockEnabled?: boolean;
  attendanceLockAfterDays?: number;
  attendanceLockMode?: string;
  attendanceLockDay?: number;
  timezone?: string;
  logoUrl?: string;
  payrollCutoffDay?: number;
  payrollSalaryPayDay?: number;
  payrollEnabled?: boolean;
  minWorkHoursPerDay?: number;
  minHalfDayHours?: number;
  attendanceIpEnabled?: boolean;
  attendanceAllowedIp?: string;
  attendanceSelfieRequired?: boolean;
  attendanceMultiPunchEnabled?: boolean;
  attendanceGeoFenceEnabled?: boolean;
  attendanceGeoLatitude?: number | null;
  attendanceGeoLongitude?: number | null;
  attendanceGeoRadiusMeters?: number;
  attendanceDevBypassEnabled?: boolean;
  probationPeriodDays?: number;
  noticePeriodDays?: number;
  employeeIdPrefix?: string;
  maxActiveLoginsPerUser?: number;
  themeMode?: "preset" | "custom";
  themePreset?: OrgThemePreset;
  themeConfig?: OrgThemeConfig;
};

export const TopNavbar = ({ title, breadcrumb, onOpenSidebar }: TopNavbarProps) => {
  const navigate = useNavigate();
  const { profile, setProfile, setPermissions, hasAnyPermission } = useAuth();
  const roles = useMemo(() => profile?.roles || [], [profile]);
  const activeRole = useMemo(() => profile?.activeRole || roles?.[0] || null, [profile, roles]);
  const profileImageUrl = /^https?:\/\//i.test(String(profile?.profileImage || "")) ||
    /^data:image\//i.test(String(profile?.profileImage || ""))
    ? profile?.profileImage
    : undefined;
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [orgSettings, setOrgSettings] = useState<OrgSettingsSnapshot | null>(null);
  const [themeEditorOpen, setThemeEditorOpen] = useState(false);
  const [savingTheme, setSavingTheme] = useState(false);
  const canManageSettings = hasAnyPermission(["ORG_SETTINGS_MANAGE"]);
  const currentThemeMode = orgSettings?.themeMode || "preset";
  const currentThemePreset = orgSettings?.themePreset || "ocean";
  const [customTheme, setCustomTheme] = useState<OrgThemeConfig>({
    primary: "",
    secondary: "",
    background: "",
    foreground: "",
    sidebar: "",
    sidebarForeground: "",
    accent: "",
    card: "",
    muted: "",
    border: "",
    ring: ""
  });

  const loadNotifications = async (showLoader = false) => {
    if (showLoader) setLoadingNotifications(true);
    const res: any = await getApiWithToken("/notifications/my?limit=8", null, {
      requiredPermissions: ["NOTIFICATION_VIEW_SELF"]
    });
    if (res?.success) {
      setNotifications(res?.data?.items || []);
      setUnreadCount(Number(res?.data?.unreadCount || 0));
    }
    if (showLoader) setLoadingNotifications(false);
  };

  useEffect(() => {
    loadNotifications(true);
  }, []);

  const loadThemeSettings = async () => {
    if (!canManageSettings) return;
    const res: any = await getApiWithToken("/org-settings", null, {
      requiredPermissions: ["ORG_SETTINGS_VIEW"]
    });
    if (res?.success) {
      setOrgSettings(res.data || null);
      setCustomTheme({
        primary: res.data?.themeConfig?.primary || "",
        secondary: res.data?.themeConfig?.secondary || "",
        background: res.data?.themeConfig?.background || "",
        foreground: res.data?.themeConfig?.foreground || "",
        sidebar: res.data?.themeConfig?.sidebar || "",
        sidebarForeground: res.data?.themeConfig?.sidebarForeground || "",
        accent: res.data?.themeConfig?.accent || "",
        card: res.data?.themeConfig?.card || "",
        muted: res.data?.themeConfig?.muted || "",
        border: res.data?.themeConfig?.border || "",
        ring: res.data?.themeConfig?.ring || ""
      });
      applyThemeToDocument(res.data);
    }
  };

  useEffect(() => {
    loadThemeSettings();
  }, [canManageSettings]);

  useEffect(() => {
    applyThemeToDocument(orgSettings);
  }, [orgSettings]);

  useEffect(() => {
    return subscribeNotifications((notification: RealtimeNotification) => {
      setNotifications((previous) => {
        if (previous.some((item) => item._id === notification._id)) return previous;
        return [notification, ...previous].slice(0, 8);
      });
      if (!notification.isRead) {
        setUnreadCount((previous) => previous + 1);
      }
      toast.info(notification.title, {
        description: notification.message
      });
    });
  }, []);

  const handleSwitchRole = async (role: any) => {
    if (!role?._id) return;
    if (activeRole?._id === role._id) {
      toast.message("Role already active");
      return;
    }

    try {
      const res: any = await switchRole(role._id);
      if (!res?.success) {
        toast.error(res?.message || "Failed to switch role");
        return;
      }

      const newToken = res?.data?.token;
      if (newToken) {
        setToken(newToken);
        reconnectRealtimeSocket();
      }

      const newActive = res?.data?.activeRole || role;
      updateActiveRoleInProfile(newActive);
      setProfile({ ...(profile || {}), activeRole: newActive });

      try {
        const permRes = await getApiWithToken("/users/me/permissions");
        if (permRes?.success) {
          setPermissions(permRes.data || []);
        } else {
          setPermissions([]);
        }
      } catch {
        setPermissions([]);
      }

      toast.success("Role switched");
      navigate("/", { replace: true });
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to switch role");
    }
  };

  const handleLogout = () => {
    disconnectRealtimeSocket();
    clearAuth();
    navigate("/login", { replace: true });
  };

  const saveTheme = async (payload: OrgThemeSettings) => {
    if (!orgSettings) return;
    setSavingTheme(true);
    try {
      const res: any = await postApiWithToken(
        "/org-settings",
        {
          leaveCreditFrequency: orgSettings.leaveCreditFrequency || "monthly",
          leaveTypeCreditMode: orgSettings.leaveTypeCreditMode || "current_month_onwards",
          sandwichRuleEnabled: Boolean(orgSettings.sandwichRuleEnabled),
          attendanceLockEnabled: orgSettings.attendanceLockEnabled ?? true,
          attendanceLockAfterDays: Number(orgSettings.attendanceLockAfterDays ?? 7),
          attendanceLockMode: orgSettings.attendanceLockMode || "payroll_cutoff",
          attendanceLockDay: Number(orgSettings.attendanceLockDay ?? 25),
          timezone: orgSettings.timezone || "Asia/Kolkata",
          payrollCutoffDay: Number(orgSettings.payrollCutoffDay ?? 25),
          payrollSalaryPayDay: Number(orgSettings.payrollSalaryPayDay ?? 30),
          payrollEnabled: Boolean(orgSettings.payrollEnabled),
          minWorkHoursPerDay: Number(orgSettings.minWorkHoursPerDay ?? 8),
          minHalfDayHours: Number(orgSettings.minHalfDayHours ?? 4),
          attendanceIpEnabled: Boolean(orgSettings.attendanceIpEnabled),
          attendanceAllowedIp: orgSettings.attendanceAllowedIp || "",
          attendanceSelfieRequired: Boolean(orgSettings.attendanceSelfieRequired),
          attendanceMultiPunchEnabled: Boolean(orgSettings.attendanceMultiPunchEnabled),
          attendanceGeoFenceEnabled: Boolean(orgSettings.attendanceGeoFenceEnabled),
          attendanceGeoLatitude: orgSettings.attendanceGeoLatitude ?? null,
          attendanceGeoLongitude: orgSettings.attendanceGeoLongitude ?? null,
          attendanceGeoRadiusMeters: Number(orgSettings.attendanceGeoRadiusMeters ?? 200),
          attendanceDevBypassEnabled: Boolean(orgSettings.attendanceDevBypassEnabled),
          probationPeriodDays: Number(orgSettings.probationPeriodDays ?? 90),
          noticePeriodDays: Number(orgSettings.noticePeriodDays ?? 30),
          employeeIdPrefix: orgSettings.employeeIdPrefix || "",
          maxActiveLoginsPerUser: Number(orgSettings.maxActiveLoginsPerUser ?? 1),
          logoUpload: undefined,
          themeMode: payload.themeMode || "preset",
          themePreset: payload.themePreset || "ocean",
          themeConfig: payload.themeConfig || {}
        },
        null,
        { requiredPermissions: ["ORG_SETTINGS_MANAGE"] }
      );
      if (res?.success) {
        setOrgSettings(res.data || null);
        applyThemeToDocument(res.data);
        toast.success("Theme updated");
        setThemeEditorOpen(false);
      } else {
        toast.error(res?.message || "Failed to update theme");
      }
    } finally {
      setSavingTheme(false);
    }
  };

  const markOneNotificationRead = async (id: string) => {
    const res: any = await patchApiWithToken(`/notifications/${id}/read`, {}, null, {
      requiredPermissions: ["NOTIFICATION_MANAGE_SELF"]
    });
    if (!res?.success) return;
    setNotifications((prev) => prev.map((n) => (n._id === id ? { ...n, isRead: true } : n)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
  };

  const markAllNotificationsRead = async () => {
    const res: any = await patchApiWithToken("/notifications/read-all", {}, null, {
      requiredPermissions: ["NOTIFICATION_MANAGE_SELF"]
    });
    if (!res?.success) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
  };

  const formatNotificationTime = (value: string) => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return formatDateTimeInOrgTimeZone(d);
  };

  const updateThemePreset = (preset: OrgThemePreset) => {
    const presetConfig = THEME_PRESETS[preset]?.config || THEME_PRESETS.ocean.config;
    const nextTheme = {
      themeMode: "preset" as const,
      themePreset: preset,
      themeConfig: presetConfig
    };
    setOrgSettings((prev) => (prev ? { ...prev, ...nextTheme } : prev));
    applyThemeToDocument(nextTheme);
    void saveTheme(nextTheme);
  };

  const updateCustomThemeField = (key: keyof OrgThemeConfig, value: string) => {
    setCustomTheme((prev) => ({ ...prev, [key]: value }));
  };

  const quickLinks = [
    { label: "Documents", icon: FileText, path: "/organization/documents" },
    { label: "News", icon: Newspaper, path: "/documentation" },
    { label: "Payslip", icon: WalletCards, path: "/employee-dashboard/payslips" },
    { label: "Report", icon: BarChart3, path: "/performance" },
  ];

  return (
    <header className="sticky top-0 z-40 flex h-[76px] items-center justify-between border-b border-slate-100 bg-[#f8f8f6]/95 px-3 backdrop-blur sm:px-5 lg:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <button
          type="button"
          className="rounded-xl p-2 text-slate-500 hover:bg-white lg:hidden"
          aria-label="Open sidebar"
          onClick={onOpenSidebar}
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="relative hidden w-full max-w-[270px] sm:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search anything..."
            className="h-11 rounded-xl border-0 bg-white pl-10 pr-12 text-sm shadow-sm focus-visible:ring-1 focus-visible:ring-emerald-400"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded-md border border-slate-100 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-500 md:block">
            Cmd F
          </kbd>
        </div>
        <nav className="hidden items-center gap-1 xl:flex">
          {quickLinks.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => navigate(item.path)}
                className="flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium text-slate-600 transition hover:bg-white hover:text-slate-950"
              >
                <Icon className="h-4 w-4 text-slate-400" />
                {item.label}
              </button>
            );
          })}
        </nav>
        {title && <h1 className="truncate text-sm font-semibold text-slate-400 xl:hidden">{title}</h1>}
      </div>

      <div className="flex items-center gap-2">
        <DropdownMenu onOpenChange={(open) => open && loadNotifications(true)}>
          <DropdownMenuTrigger className="relative rounded-xl bg-white p-2.5 shadow-sm transition-colors hover:bg-slate-50">
            <Bell className="h-4 w-4 text-slate-600" />
            {unreadCount > 0 && (
              <Badge className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px]">
                {unreadCount > 9 ? "9+" : unreadCount}
              </Badge>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <div className="flex items-center justify-between px-2 py-1.5">
              <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
              <button
                type="button"
                className="text-xs text-primary hover:underline disabled:text-muted-foreground"
                onClick={markAllNotificationsRead}
                disabled={!unreadCount}
              >
                Mark all read
              </button>
            </div>
            <DropdownMenuSeparator />
            {loadingNotifications && (
              <div className="px-2 py-3 text-sm text-muted-foreground">Loading...</div>
            )}
            {!loadingNotifications && notifications.length === 0 && (
              <div className="px-2 py-3 text-sm text-muted-foreground">No notifications</div>
            )}
            {!loadingNotifications &&
              notifications.map((item) => (
                <DropdownMenuItem
                  key={item._id}
                  className={`group flex flex-col items-start gap-1 py-3 ${item.isRead ? "" : "bg-muted/40"}`}
                  onClick={() => markOneNotificationRead(item._id)}
                >
                  <span className="font-medium group-data-[highlighted]:text-accent-foreground">
                    {item.title}
                  </span>
                  <span className="text-xs text-muted-foreground group-data-[highlighted]:text-accent-foreground/90">
                    {item.message}
                  </span>
                  <span className="text-[11px] text-muted-foreground group-data-[highlighted]:text-accent-foreground/80">
                    {formatNotificationTime(item.createdAt)}
                  </span>
                </DropdownMenuItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {canManageSettings && (
          <DropdownMenu>
            <DropdownMenuTrigger className="relative flex items-center gap-2 rounded-xl bg-white p-2.5 text-sm shadow-sm transition-colors hover:bg-slate-50">
              <Paintbrush className="h-4 w-4 text-slate-600" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4" />
                Organization Theme
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {Object.entries(THEME_PRESETS).map(([key, preset]) => (
                <DropdownMenuItem key={key} onClick={() => updateThemePreset(key as OrgThemePreset)}>
                  <span className="flex items-center gap-2">
                    <span
                      className="h-3.5 w-3.5 rounded-full border"
                      style={{ backgroundColor: `hsl(${preset.config.primary})` }}
                    />
                    {preset.label}
                    {currentThemeMode === "preset" && currentThemePreset === key ? " (active)" : ""}
                  </span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setThemeEditorOpen(true)}>
                Custom theme...
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Settings */}
        {/* <button className="p-2 rounded-lg hover:bg-muted transition-colors">
          <Settings className="w-5 h-5 text-muted-foreground" />
        </button> */}

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-xl bg-white py-1.5 pl-1.5 pr-2 shadow-sm">
            <Avatar className="h-8 w-8">
              <AvatarImage src={profileImageUrl} />
              <AvatarFallback className="bg-emerald-50 text-xs font-semibold text-emerald-700">
               {profile?.firstName && profile?.lastName
              ? `${profile.firstName[0]}${profile.lastName[0]}`
              : profile?.firstName?.[0] ||
                profile?.lastName?.[0] ||
                profile?.email?.[0] ||
                "U"}
              </AvatarFallback>
            </Avatar>
            <div className="hidden text-left lg:block">
              <p className="max-w-32 truncate text-sm font-semibold text-slate-900">
                {profile?.firstName || profile?.lastName
                  ? `${profile?.firstName || ""} ${profile?.lastName || ""}`.trim()
                  : profile?.email || "User"}
              </p>
              <p className="max-w-32 truncate text-xs text-slate-400">
                {activeRole?.name || "Role"}
              </p>
            </div>
            <ChevronDown className="h-4 w-4 text-slate-400" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href="/profile">Profile</a>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/change-password")}>
              Change Password
            </DropdownMenuItem>
            {/* <DropdownMenuItem>Settings</DropdownMenuItem> */}
            {/* <DropdownMenuItem>Billing</DropdownMenuItem> */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                Switch role
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56">
                {roles?.length ? (
                  roles.map((role: any) => (
                    <DropdownMenuItem
                      key={role._id}
                      onClick={() => handleSwitchRole(role)}
                    >
                      {role?.name || role?.slug || "Role"}
                      {activeRole?._id === role._id ? " (active)" : ""}
                    </DropdownMenuItem>
                  ))
                ) : (
                  <DropdownMenuItem disabled>No roles</DropdownMenuItem>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={handleLogout}>
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={themeEditorOpen} onOpenChange={setThemeEditorOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Custom Theme</DialogTitle>
            <DialogDescription>
              Set your organization palette. Use HSL values like `156 62% 43%` for best results.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            {(["primary", "secondary", "background", "foreground", "sidebar", "sidebarForeground", "accent", "card", "muted", "border", "ring"] as const).map((field) => (
              <label key={field} className="space-y-2">
                <span className="text-sm font-medium capitalize">{field.replace(/([A-Z])/g, " $1")}</span>
                <Input
                  value={customTheme[field] || ""}
                  onChange={(e) => updateCustomThemeField(field, e.target.value)}
                  placeholder="e.g. 156 62% 43%"
                />
              </label>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                const presetConfig = THEME_PRESETS.ocean.config;
                setCustomTheme(presetConfig);
              }}
            >
              Reset
            </Button>
            <Button
              type="button"
              disabled={savingTheme}
              onClick={() =>
                void saveTheme({
                  themeMode: "custom",
                  themePreset: currentThemePreset,
                  themeConfig: customTheme
                })
              }
            >
              <Save className="mr-2 h-4 w-4" />
              {savingTheme ? "Saving..." : "Save Theme"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
};
