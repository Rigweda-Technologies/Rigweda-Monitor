import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopNavbar } from "./TopNavbar";
import { cn } from "@/lib/utils";
import { getOrgTimeZone, subscribeToOrgTimeZone } from "@/utils/timezone";

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

const MainLayoutContext = createContext<MainLayoutContextValue | null>(null);

export const MainLayout = ({ children, title, breadcrumb }: MainLayoutProps) => {
  const parentLayout = useContext(MainLayoutContext);
  const location = useLocation();
  const [header, setHeader] = useState<HeaderState>({ title, breadcrumb });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [timeZoneVersion, setTimeZoneVersion] = useState(() => getOrgTimeZone());
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

  if (parentLayout) {
    return <>{children}</>;
  }

  return (
    <MainLayoutContext.Provider value={contextValue}>
      <div key={timeZoneVersion} className="min-h-screen bg-background flex">
        <Sidebar
          mobileOpen={mobileSidebarOpen}
          onMobileClose={handleMobileClose}
          collapsed={sidebarCollapsed}
          onCollapsedChange={handleCollapsedChange}
        />
        <div className={cn(
          "relative flex-1 min-w-0 flex flex-col transition-all duration-300",
          sidebarCollapsed ? "lg:ml-[72px]" : "lg:ml-[260px]"
        )}>
          <div
            className={cn(
              "pointer-events-none absolute left-0 right-0 top-0 z-30 h-0.5 overflow-hidden bg-transparent transition-opacity duration-200",
              routeLoading ? "opacity-100" : "opacity-0"
            )}
          >
            <div className="h-full w-1/3 animate-[pulse_900ms_ease-in-out_infinite] bg-gradient-to-r from-blue-400/0 via-blue-400 to-cyan-300/0" />
          </div>
          <TopNavbar
            title={header.title}
            breadcrumb={header.breadcrumb}
            onOpenSidebar={() => setMobileSidebarOpen(true)}
          />
          <main
            className={cn(
              "flex-1 min-w-0 p-3 sm:p-4 lg:p-6 overflow-y-auto overflow-x-hidden animate-fade-in transition-opacity duration-200",
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
