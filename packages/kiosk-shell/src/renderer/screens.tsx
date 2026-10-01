import { useEffect, useState, type FormEvent } from "react";
import { EXPIRY_WARNING_SEC, type ShellState } from "@asd/shared";
import type { RestoreFailure } from "../common/api";
import logoUrl from "../../assets/logo.svg";
import { api, formatClock } from "./api";
import { t } from "./strings";

export function LockedScreen({ serviceDown }: { readonly serviceDown: boolean }) {
  return (
    <div className="screen locked">
      <img className="logo" src={logoUrl} alt="ASD" />
      <h1>{t.locked.title}</h1>
      <p className="big">{t.locked.askDesk}</p>
      {serviceDown && <p className="small-note">{t.locked.serviceDown}</p>}
    </div>
  );
}

export function MaintenanceScreen() {
  return (
    <div className="screen locked">
      <h1>{t.maintenance.title}</h1>
      <p className="big">{t.maintenance.detail}</p>
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
        <img className="logo small" src={logoUrl} alt="ASD" />
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
            {state.apps.map((app) => (
              <button key={app.id} className="tile" onClick={() => void run(() => api.launchApp(app.id))}>
                <AppIcon id={app.id} />
                <span>{app.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {state.sites.length > 0 && (
        <section>
          <h2>{t.launcher.sites}</h2>
          <div className="tiles">
            {state.sites.map((site) => (
              <button key={site.id} className="tile site" onClick={() => void run(() => api.openSite(site.id))}>
                <span className="globe">🌐</span>
                <span>{site.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function AppIcon({ id }: { readonly id: ShellState["apps"][number]["id"] }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void api.appIcon(id).then((icon) => active && setSrc(icon));
    return () => {
      active = false;
    };
  }, [id]);
  return src === null ? <span className="icon-placeholder" /> : <img className="icon" src={src} alt="" />;
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
