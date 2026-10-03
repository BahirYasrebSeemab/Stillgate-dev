import { useEffect, useState, type FormEvent } from "react";
import { EXPIRY_WARNING_SEC, type ShellState } from "@asd/shared";
import type { RestoreFailure } from "../common/api";
import logoUrl from "../../assets/logo.svg";
import { api, formatClock } from "./api";
import { t } from "./strings";
import { Waves } from "./Waves";

// Flat square tiles in the style of the Windows 8 Start screen
const TILE_COLORS = ["#7b1e3a", "#1b2a4e", "#00788a", "#a4373a", "#2d5f8b", "#5c2d91", "#00825a", "#b04a1c"];
const tileColor = (index: number) => TILE_COLORS[index % TILE_COLORS.length];

export function LockedScreen({ serviceDown }: { readonly serviceDown: boolean }) {
  return (
    <div className="screen locked">
      <Waves />
      <div className="locked-content">
        <img className="logo" src={logoUrl} alt="American Space Dushanbe" />
        <h1>{t.locked.title}</h1>
        <p className="big">{t.locked.askDesk}</p>
      </div>
      {serviceDown && <p className="small-note">{t.locked.serviceDown}</p>}
    </div>
  );
}

export function MaintenanceScreen() {
  return (
    <div className="screen locked">
      <div className="locked-content">
        <h1>{t.maintenance.title}</h1>
        <p className="big">{t.maintenance.detail}</p>
      </div>
    </div>
  );
}

type LauncherProps = { readonly state: ShellState; readonly remainingSec: number };

export function Launcher({ state, remainingSec }: LauncherProps) {
  const [error, setError] = useState<string | null>(null);
  const run = async (open: () => Promise<{ ok: boolean }>) => {
    const result = await open();
    setError(result.ok ? null : t.launcher.failed);
  };
  const warn = remainingSec <= EXPIRY_WARNING_SEC;

  return (
    <div className="screen launcher">
      <header>
        <img className="logo small" src={logoUrl} alt="American Space Dushanbe" />
        <div className={`clock ${warn ? "warn" : ""}`}>
          <span>{t.launcher.timeLeft}</span>
          <strong>{formatClock(remainingSec)}</strong>
        </div>
      </header>
      {warn && <div className="banner">{t.launcher.warning}</div>}
      {error !== null && <div className="banner error">{error}</div>}
      {state.apps.length === 0 && state.sites.length === 0 && <p className="big">{t.launcher.empty}</p>}
      {state.apps.length > 0 && (
        <section>
          <h2>{t.launcher.apps}</h2>
          <div className="tiles">
            {state.apps.map((app, index) => (
              <Tile key={app.id} name={app.name} color={tileColor(index)} loadIcon={() => api.appIcon(app.id)}
                onOpen={() => void run(() => api.launchApp(app.id))} />
            ))}
          </div>
        </section>
      )}
      {state.sites.length > 0 && (
        <section>
          <h2>{t.launcher.sites}</h2>
          <div className="tiles">
            {state.sites.map((site, index) => (
              <Tile key={site.id} name={site.name} color={tileColor(index + state.apps.length)}
                loadIcon={() => api.siteIcon(site.id)} fallback="🌐" onOpen={() => void run(() => api.openSite(site.id))} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

type TileProps = {
  readonly name: string;
  readonly color: string | undefined;
  readonly loadIcon: () => Promise<string | null>;
  readonly onOpen: () => void;
  readonly fallback?: string;
};

function Tile({ name, color, loadIcon, onOpen, fallback }: TileProps) {
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void loadIcon().then((data) => active && setIcon(data));
    return () => {
      active = false;
    };
    // Load the icon once per tile (loadIcon is a new function on every render, so it is not a dependency)
  }, [name]);

  return (
    <button className="tile" style={{ backgroundColor: color }} onClick={onOpen}>
      <span className="tile-icon">
        {icon !== null ? <img src={icon} alt="" /> : <span className="tile-fallback">{fallback ?? name.slice(0, 1)}</span>}
      </span>
      <span className="tile-name">{name}</span>
    </button>
  );
}

export function PasswordPanel({ onClose }: { readonly onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const result = await api.restore(password);
    setPassword("");
    setBusy(false);
    setMessage(result.ok ? t.password.restoring : failureText(result.error));
  };

  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <form className="panel" onSubmit={(e) => void submit(e)}>
        <h2>{t.password.title}</h2>
        <label>
          {t.password.label}
          <input type="password" autoFocus value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {message !== null && <p className="message">{message}</p>}
        <div className="buttons">
          <button type="button" onClick={onClose}>{t.password.cancel}</button>
          <button type="submit" className="primary" disabled={busy || password === ""}>{t.password.submit}</button>
        </div>
      </form>
    </div>
  );
}

function failureText(failure: RestoreFailure): string {
  switch (failure.reason) {
    case "wrong_password":
      return t.password.wrong;
    case "locked_out":
      return t.password.lockedOut(failure.retryAfterSec);
    case "no_password_set":
      return t.password.noPassword;
    case "service_unavailable":
      return t.password.unavailable;
  }
}

