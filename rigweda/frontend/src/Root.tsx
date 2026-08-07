import App from "./App";
import {useAuth} from "./features/auth/AuthProvider";
import {LoginPage} from "./pages/LoginPage";
import {useEffect} from "react";
import {authApi} from "./features/auth/auth.api";
import {useTheme} from "./theme/ThemeProvider";
import type {Appearance,ThemeId} from "./theme/themes";

type ThemePreference = {
  preset?: ThemeId;
  appearance?: Appearance;
  customPrimary?: string;
  customAccent?: string;
};

export function Root() {
  const {user, ready, logout} = useAuth();
  const {setTheme, setAppearance, setCustomColors} = useTheme();

  useEffect(() => {
    if (!user) return;

    authApi.preferences().then((preferences) => {
      const selected = (preferences.theme || user.organizationTheme) as ThemePreference;
      if (selected.preset) setTheme(selected.preset);
      if (selected.appearance) setAppearance(selected.appearance);
      if (selected.customPrimary && selected.customAccent) {
        setCustomColors(selected.customPrimary, selected.customAccent);
      }
    }).catch(() => {});
  }, [user, setTheme, setAppearance, setCustomColors]);

  if (!ready) return <div className="app-loading"><span/><strong>Preparing your workspace…</strong></div>;
  if (!user) return <LoginPage/>;
  return <App onSignOut={logout}/>;
}
