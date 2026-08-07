import { Check, Desktop, Moon, Palette, Sun, X } from "@phosphor-icons/react";
import { useTheme } from "../theme/ThemeProvider";
import { themes, type Appearance, type ThemeId } from "../theme/themes";
import { readableOnWhite } from "../theme/color";
import { authApi } from "../features/auth/auth.api";

export function ThemePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme, appearance, setTheme, setAppearance, customPrimary, customAccent, setCustomColors } = useTheme();
  const customIsReadable = readableOnWhite(customPrimary);
  if (!open) return null;
  const modes: [Appearance, typeof Sun][] = [["light", Sun], ["dark", Moon], ["system", Desktop]];
  return (
    <div className="panel-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="theme-panel" role="dialog" aria-modal="true" aria-labelledby="theme-title">
        <header><div className="panel-title-icon"><Palette /></div><div><h2 id="theme-title">Choose your atmosphere</h2><p>Personalize Rigweda without changing how it works.</p></div><button className="icon-button" onClick={onClose}><X /><span className="sr-only">Close</span></button></header>
        <div className="appearance-row" aria-label="Appearance">
          {modes.map(([mode, Icon]) => <button key={mode} className={appearance === mode ? "selected" : ""} onClick={() => setAppearance(mode)}><Icon size={17} />{mode}</button>)}
        </div>
        <div className="theme-grid">
          {Object.entries(themes).map(([id, option]) => (
            <button key={id} className={`theme-option ${theme === id ? "selected" : ""}`} onClick={() => setTheme(id as ThemeId)}>
              <span className="swatches">{option.colors.map((color) => <i key={color} style={{ background: color }} />)}</span>
              <span><strong>{option.label}</strong><small>{option.description}</small></span>
              {theme === id && <Check className="theme-check" size={18} />}
            </button>
          ))}
          <div className={`custom-theme ${theme === "custom" ? "selected" : ""}`}>
            <button className="custom-theme-title" onClick={() => setTheme("custom")}><span><strong>Custom</strong><small>Build your own palette</small></span>{theme === "custom" && <Check size={18} />}</button>
            <div className="color-fields"><label>Primary <span><input type="color" value={customPrimary} onChange={(event) => setCustomColors(event.target.value, customAccent)} /><code>{customPrimary}</code></span></label><label>Accent <span><input type="color" value={customAccent} onChange={(event) => setCustomColors(customPrimary, event.target.value)} /><code>{customAccent}</code></span></label></div>
            {!customIsReadable && <p className="contrast-warning">Choose a darker primary color so white text remains readable.</p>}
          </div>
        </div>
        <footer><p>Your personal choice follows your account.</p><button className="primary-button" disabled={theme === "custom" && !customIsReadable} onClick={async()=>{await authApi.updatePreferences({theme:{preset:theme,appearance,customPrimary:theme==="custom"?customPrimary:null,customAccent:theme==="custom"?customAccent:null}}).catch(()=>{});onClose();}}>Apply theme</button></footer>
      </section>
    </div>
  );
}
