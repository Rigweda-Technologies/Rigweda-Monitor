import { createContext, ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopNavbar } from "./TopNavbar";
import { cn } from "@/lib/utils";
import { getApiWithToken } from "@/services/apiWrapper";
import { getOrgTimeZone, subscribeToOrgTimeZone } from "@/utils/timezone";
import { applyThemeToDocument, OrgThemeConfig, OrgThemePreset } from "@/utils/theme";

interface MainLayoutProps {
  children: ReactNode;
  title?: string;
  breadcrumb?: { label: string; href?: string }[];
}

type HeaderState = {
  title?: string;
  breadcrumb?: { label: string; href?: string }[];
};

type MainLayoutContextValue = {
  setHeader: (header: HeaderState) => void;
};

type OrgSettingsSnapshot = {
  organizationName?: string;
  logoUrl?: string;
  themeMode?: "preset" | "custom";
  themePreset?: OrgThemePreset;
  themeConfig?: OrgThemeConfig;
};

const ORG_SETTINGS_CACHE_KEY = "rigweda_hrms_org_settings_snapshot";

const readCachedOrgSettings = (): OrgSettingsSnapshot | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ORG_SETTINGS_CACHE_KEY);
    return raw ? JSON.parse(raw) as OrgSettingsSnapshot : null;
  } catch {
    return null;
  }
};

const cacheOrgSettings = (settings: OrgSettingsSnapshot | null) => {
  if (typeof window === "undefined" || !settings) return;
  try {
    window.localStorage.setItem(ORG_SETTINGS_CACHE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota/private-mode failures; API data remains authoritative.
  }
};

const MainLayoutContext = createContext<MainLayoutContextValue | null>(null);

export const MainLayout = ({ children, title, breadcrumb }: MainLayoutProps) => {
  const parentLayout = useContext(MainLayoutContext);
  const location = useLocation();
  const [header, setHeader] = useState<HeaderState>({ title, breadcrumb });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [timeZoneVersion, setTimeZoneVersion] = useState(() => getOrgTimeZone());
  const [orgSettings, setOrgSettings] = useState<OrgSettingsSnapshot | null>(() => readCachedOrgSettings());
  const handleMobileClose = useCallback(() => setMobileSidebarOpen(false), []);
  const handleCollapsedChange = useCallback((collapsed: boolean) => setSidebarCollapsed(collapsed), []);

  useEffect(() => {
    if (!parentLayout) {
      setHeader({ title, breadcrumb });
      return;
    }
    parentLayout.setHeader({ title, breadcrumb });
  }, [parentLayout, title, breadcrumb]);

  const contextValue = useMemo<MainLayoutContextValue>(() => ({ setHeader }), []);

  useEffect(() => {
    setRouteLoading(true);
    const timer = window.setTimeout(() => setRouteLoading(false), 220);
    return () => window.clearTimeout(timer);
  }, [location.pathname]);

  useEffect(() => subscribeToOrgTimeZone(setTimeZoneVersion), []);

  useLayoutEffect(() => {
    if (!orgSettings) return;
    applyThemeToDocument(orgSettings);
  }, [orgSettings]);

  useEffect(() => {
    let cancelled = false;
    const loadOrgSettings = async () => {
      const res = await getApiWithToken("/org-settings", null, {
        suppressPermissionError: true,
        forceRefresh: true
      });
      if (!cancelled && res?.success) {
        setOrgSettings(res.data || null);
        cacheOrgSettings(res.data || null);
        applyThemeToDocument(res.data || null);
      }
    };
    void loadOrgSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  if (parentLayout) {
    return <>{children}</>;
  }

  return (
    <MainLayoutContext.Provider value={contextValue}>
      <div key={timeZoneVersion} className="flex min-h-screen bg-[#f8f8f6]">
        <Sidebar
          mobileOpen={mobileSidebarOpen}
          onMobileClose={handleMobileClose}
          collapsed={sidebarCollapsed}
          onCollapsedChange={handleCollapsedChange}
          orgSettings={orgSettings}
        />
        <div className={cn(
          "relative flex-1 min-w-0 flex flex-col transition-all duration-300",
          sidebarCollapsed ? "lg:ml-[72px]" : "lg:ml-[280px]"
        )}>
          <div
            className={cn(
              "pointer-events-none absolute left-0 right-0 top-0 z-30 h-0.5 overflow-hidden bg-transparent transition-opacity duration-200",
              routeLoading ? "opacity-100" : "opacity-0"
            )}
          >
            <div className="h-full w-1/3 animate-[pulse_900ms_ease-in-out_infinite] bg-gradient-to-r from-emerald-400/0 via-emerald-400 to-teal-300/0" />
          </div>
          <TopNavbar
            title={header.title}
            breadcrumb={header.breadcrumb}
            onOpenSidebar={() => setMobileSidebarOpen(true)}
            initialOrgSettings={orgSettings}
          />
          <main
            className={cn(
              "min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3 transition-opacity duration-200 animate-fade-in sm:p-4 lg:p-5",
              routeLoading ? "opacity-[0.985]" : "opacity-100"
            )}
          >
            {children}
          </main>
        </div>
      </div>
    </MainLayoutContext.Provider>
  );
};
