import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Bell, Settings, ChevronDown, Menu } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { getApiWithToken, patchApiWithToken, switchRole } from "@/services/apiWrapper";
import { clearAuth, setToken, updateActiveRoleInProfile } from "@/utils/auth";
import { useAuth } from "@/context/useAuth";
import { toast } from "sonner";
import { formatDateTimeInOrgTimeZone } from "@/utils/timezone";
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

export const TopNavbar = ({ title, breadcrumb, onOpenSidebar }: TopNavbarProps) => {
  const navigate = useNavigate();
  const { profile, setProfile, setPermissions } = useAuth();
  const roles = useMemo(() => profile?.roles || [], [profile]);
  const activeRole = useMemo(() => profile?.activeRole || roles?.[0] || null, [profile, roles]);
  const organizationName = profile?.organization?.name || profile?.activeOrganization?.name || "Organization";
  const profileImageUrl = /^https?:\/\//i.test(String(profile?.profileImage || "")) ||
    /^data:image\//i.test(String(profile?.profileImage || ""))
    ? profile?.profileImage
    : undefined;
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadingNotifications, setLoadingNotifications] = useState(false);

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

  return (
    <header className="relative h-16 bg-card border-b border-border flex items-center justify-between px-3 sm:px-4 lg:px-6 sticky top-0 z-40">
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 hidden md:flex items-center pointer-events-none">
        <div className="max-w-[320px] rounded-full border border-border/80 bg-muted/50 px-4 py-1 text-sm font-medium text-foreground truncate">
          {organizationName}
        </div>
      </div>
      {/* Left Section */}
      <div className="flex items-center gap-2 sm:gap-4 min-w-0">
        <button
          type="button"
          className="lg:hidden p-2 rounded-md hover:bg-muted"
          aria-label="Open sidebar"
          onClick={onOpenSidebar}
        >
          <Menu className="w-5 h-5 text-muted-foreground" />
        </button>
        {breadcrumb && breadcrumb.length > 0 && (
          <nav className="breadcrumb hidden md:flex">
            {/* {breadcrumb.map((item, index) => (
              <span key={index} className="flex items-center gap-2">
                {index > 0 && <span>/</span>}
                {item.href ? (
                  <a href={item.href} className="hover:text-primary transition-colors">
                    {item.label}
                  </a>
                ) : (
                  <span className="text-foreground font-medium">{item.label}</span>
                )}
              </span>
            ))} */}
          </nav>
        )}
        {title && <h1 className="page-header truncate">{title}</h1>}
      </div>

      {/* Right Section */}
      <div className="flex items-center gap-2 sm:gap-4">
        {/* Search */}
        {/*<div className="relative hidden xl:block w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search..."
            className="pl-10 bg-muted/50 border-0 focus-visible:ring-1 focus-visible:ring-primary"
          />
        </div>*/}

        {/* Notifications */}
        <DropdownMenu onOpenChange={(open) => open && loadNotifications(true)}>
          <DropdownMenuTrigger className="relative p-2 rounded-lg hover:bg-muted transition-colors">
            <Bell className="w-5 h-5 text-muted-foreground" />
            {unreadCount > 0 && (
              <Badge className="absolute -top-1 -right-1 min-w-5 h-5 flex items-center justify-center px-1 text-xs bg-destructive">
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

        {/* Settings */}
        {/* <button className="p-2 rounded-lg hover:bg-muted transition-colors">
          <Settings className="w-5 h-5 text-muted-foreground" />
        </button> */}

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 pl-4 border-l border-border">
            <Avatar className="w-9 h-9">
              <AvatarImage src={profileImageUrl} />
              <AvatarFallback>
               {profile?.firstName && profile?.lastName
              ? `${profile.firstName[0]}${profile.lastName[0]}`
              : profile?.firstName?.[0] ||
                profile?.lastName?.[0] ||
                profile?.email?.[0] ||
                "U"}
              </AvatarFallback>
            </Avatar>
            <div className="text-left hidden lg:block">
              <p className="text-sm font-medium">
                {profile?.firstName || profile?.lastName
                  ? `${profile?.firstName || ""} ${profile?.lastName || ""}`.trim()
                  : profile?.email || "User"}
              </p>
              <p className="text-xs text-muted-foreground">
                {activeRole?.name || "Role"}
              </p>
            </div>
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
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
    </header>
  );
};
