export type OrgThemeMode = "preset" | "custom";
export type OrgThemePreset = "ocean" | "forest" | "sunset" | "graphite";

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
  themeMode?: OrgThemeMode;
  themePreset?: OrgThemePreset;
  themeConfig?: OrgThemeConfig | null;
};

export const THEME_PRESETS: Record<OrgThemePreset, { label: string; config: Required<OrgThemeConfig> }> = {
  ocean: {
    label: "Ocean",
    config: {
      primary: "217 89% 45%",
      secondary: "220 14% 96%",
      background: "220 20% 97%",
      foreground: "220 20% 14%",
      sidebar: "217 89% 45%",
      sidebarGradientStart: "217 89% 39%",
      sidebarGradientEnd: "217 89% 32%",
      sidebarForeground: "0 0% 100%",
      accent: "217 89% 45%",
      card: "0 0% 100%",
      muted: "220 14% 96%",
      border: "220 20% 90%",
      ring: "217 89% 45%"
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
  const theme = getResolvedThemeConfig(settings);
  const root = document.documentElement;
  Object.entries(theme).forEach(([key, value]) => {
    if (!value) return;
    const cssVar = `--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
    root.style.setProperty(cssVar, value);
  });
  if (!theme.sidebarGradientStart) {
    root.style.setProperty("--sidebar-gradient-start", theme.sidebar || theme.primary || "217 89% 39%");
  }
  if (!theme.sidebarGradientEnd) {
    root.style.setProperty("--sidebar-gradient-end", theme.sidebar || theme.primary || "217 89% 32%");
  }
};
