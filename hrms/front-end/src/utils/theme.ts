export type OrgThemeMode = "preset" | "custom";
export type OrgThemePreset = "ocean" | "forest" | "sunset" | "graphite";

export const SIDEBAR_COLOR_OPTIONS = [
  { key: "monitor", label: "Monitor Navy", start: "208 68% 13%", end: "204 70% 8%", foreground: "210 40% 96%" },
  { key: "slate", label: "Slate Blue", start: "221 39% 22%", end: "224 43% 13%", foreground: "210 40% 98%" },
  { key: "forest", label: "Forest Green", start: "155 72% 28%", end: "155 72% 18%", foreground: "0 0% 100%" },
  { key: "graphite", label: "Graphite", start: "220 10% 20%", end: "220 12% 11%", foreground: "0 0% 100%" }
] as const;

export const THEME_COLOR_OPTIONS = [
  { key: "teal", label: "Monitor Teal", primary: "173 80% 36%" },
  { key: "emerald", label: "Emerald", primary: "156 62% 43%" },
  { key: "blue", label: "Signal Blue", primary: "199 89% 48%" },
  { key: "orange", label: "Alert Orange", primary: "18 90% 52%" }
] as const;

export type OrgThemeConfig = {
  primary?: string;
  secondary?: string;
  background?: string;
  foreground?: string;
  sidebar?: string;
  sidebarGradientStart?: string;
  sidebarGradientEnd?: string;
  sidebarForeground?: string;
  accent?: string;
  card?: string;
  muted?: string;
  border?: string;
  ring?: string;
};

export type OrgThemeSettings = {
  logoUrl?: string;
  themeMode?: OrgThemeMode;
  themePreset?: OrgThemePreset;
  themeConfig?: OrgThemeConfig | null;
};

export const applyOrganizationFavicon = (logoUrl?: string | null) => {
  if (typeof document === "undefined") return;
  const href = String(logoUrl || "").trim() || "/hrms-logo.png";
  const iconSelectors = [
    "link[rel='icon']",
    "link[rel='shortcut icon']",
    "link[rel='apple-touch-icon']"
  ];

  iconSelectors.forEach((selector) => {
    document.querySelectorAll<HTMLLinkElement>(selector).forEach((link) => {
      link.href = href;
      if (href.startsWith("data:image/")) {
        link.type = href.slice(5, href.indexOf(";")) || "image/png";
      }
    });
  });

  const ogImage = document.querySelector<HTMLMetaElement>("meta[property='og:image']");
  if (ogImage) ogImage.content = href;
  const twitterImage = document.querySelector<HTMLMetaElement>("meta[name='twitter:image']");
  if (twitterImage) twitterImage.content = href;
};

export const THEME_PRESETS: Record<OrgThemePreset, { label: string; config: Required<OrgThemeConfig> }> = {
  ocean: {
    label: "Emerald",
    config: {
      primary: "156 62% 43%",
      secondary: "220 14% 96%",
      background: "220 20% 97%",
      foreground: "220 20% 14%",
      sidebar: "0 0% 100%",
      sidebarGradientStart: "0 0% 100%",
      sidebarGradientEnd: "150 33% 98%",
      sidebarForeground: "215 25% 27%",
      accent: "156 62% 43%",
      card: "0 0% 100%",
      muted: "220 14% 96%",
      border: "220 20% 90%",
      ring: "156 62% 43%"
    }
  },
  forest: {
    label: "Forest",
    config: {
      primary: "155 72% 35%",
      secondary: "150 25% 95%",
      background: "150 20% 97%",
      foreground: "155 20% 14%",
      sidebar: "155 72% 28%",
      sidebarGradientStart: "155 72% 28%",
      sidebarGradientEnd: "155 72% 20%",
      sidebarForeground: "0 0% 100%",
      accent: "155 72% 35%",
      card: "0 0% 100%",
      muted: "150 20% 95%",
      border: "150 18% 88%",
      ring: "155 72% 35%"
    }
  },
  sunset: {
    label: "Sunset",
    config: {
      primary: "18 90% 52%",
      secondary: "24 100% 96%",
      background: "24 40% 97%",
      foreground: "22 20% 15%",
      sidebar: "18 90% 45%",
      sidebarGradientStart: "18 90% 45%",
      sidebarGradientEnd: "18 90% 35%",
      sidebarForeground: "0 0% 100%",
      accent: "18 90% 52%",
      card: "0 0% 100%",
      muted: "24 25% 95%",
      border: "24 20% 88%",
      ring: "18 90% 52%"
    }
  },
  graphite: {
    label: "Graphite",
    config: {
      primary: "220 8% 18%",
      secondary: "220 12% 96%",
      background: "220 20% 98%",
      foreground: "220 15% 12%",
      sidebar: "220 10% 18%",
      sidebarGradientStart: "220 10% 18%",
      sidebarGradientEnd: "220 10% 12%",
      sidebarForeground: "0 0% 100%",
      accent: "220 8% 18%",
      card: "0 0% 100%",
      muted: "220 12% 94%",
      border: "220 13% 88%",
      ring: "220 8% 18%"
    }
  }
};

export const getResolvedThemeConfig = (settings?: OrgThemeSettings | null) => {
  const preset = settings?.themePreset && THEME_PRESETS[settings.themePreset] ? settings.themePreset : "ocean";
  const base = THEME_PRESETS[preset].config;
  const custom = settings?.themeConfig || {};
  return settings?.themeMode === "custom"
    ? { ...base, ...custom }
    : base;
};

export const applyThemeToDocument = (settings?: OrgThemeSettings | null) => {
  if (typeof document === "undefined") return;
  applyOrganizationFavicon(settings?.logoUrl);
  const theme = getResolvedThemeConfig(settings);
  const root = document.documentElement;
  Object.entries(theme).forEach(([key, value]) => {
    if (!value) return;
    const cssVar = `--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
    root.style.setProperty(cssVar, value);
  });
  if (!theme.sidebarGradientStart) {
    root.style.setProperty("--sidebar-gradient-start", theme.sidebar || theme.primary || "0 0% 100%");
  }
  if (!theme.sidebarGradientEnd) {
    root.style.setProperty("--sidebar-gradient-end", theme.sidebar || theme.primary || "150 33% 98%");
  }
};
