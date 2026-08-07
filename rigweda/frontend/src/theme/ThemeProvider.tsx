import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Appearance, ThemeId } from "./themes";
import { normalizeHex, readableOnWhite, shadeHex } from "./color";

type ThemeContextValue = {
  theme: ThemeId;
  appearance: Appearance;
  setTheme: (theme: ThemeId) => void;
  setAppearance: (appearance: Appearance) => void;
  customPrimary: string;
  customAccent: string;
  setCustomColors: (primary: string, accent: string) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const THEME_KEY = "rigweda.theme";
const APPEARANCE_KEY = "rigweda.appearance";
const PRIMARY_KEY = "rigweda.customPrimary";
const ACCENT_KEY = "rigweda.customAccent";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeId>(() => (localStorage.getItem(THEME_KEY) as ThemeId) || "emerald");
  const [appearance, setAppearance] = useState<Appearance>(() => (localStorage.getItem(APPEARANCE_KEY) as Appearance) || "light");
  const [customPrimary, setCustomPrimary] = useState(() => localStorage.getItem(PRIMARY_KEY) || "#315b4f");
  const [customAccent, setCustomAccent] = useState(() => localStorage.getItem(ACCENT_KEY) || "#d08b3e");

  useEffect(() => {
    const dark = appearance === "dark" || (appearance === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.appearance = dark ? "dark" : "light";
    if (theme === "custom" && normalizeHex(customPrimary) && normalizeHex(customAccent)) {
      const safePrimary = readableOnWhite(customPrimary) ? customPrimary : "#315b4f";
      document.documentElement.style.setProperty("--primary", safePrimary);
      document.documentElement.style.setProperty("--primary-strong", shadeHex(safePrimary, .72));
      document.documentElement.style.setProperty("--primary-soft", `color-mix(in srgb, ${safePrimary}, transparent 86%)`);
      document.documentElement.style.setProperty("--accent", customAccent);
    } else {
      ["--primary", "--primary-strong", "--primary-soft", "--accent"].forEach((key) => document.documentElement.style.removeProperty(key));
    }
    localStorage.setItem(THEME_KEY, theme);
    localStorage.setItem(APPEARANCE_KEY, appearance);
  }, [theme, appearance, customPrimary, customAccent]);

  const setCustomColors = useCallback((primary: string, accent: string) => {
    setCustomPrimary(primary); setCustomAccent(accent);
    localStorage.setItem(PRIMARY_KEY, primary); localStorage.setItem(ACCENT_KEY, accent);
  }, []);

  const value = useMemo(() => ({ theme, appearance, setTheme, setAppearance, customPrimary, customAccent, setCustomColors }), [theme, appearance, customPrimary, customAccent, setCustomColors]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
