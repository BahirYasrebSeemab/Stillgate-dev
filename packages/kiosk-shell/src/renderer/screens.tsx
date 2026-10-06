import { useEffect, useState, type FormEvent, type WheelEvent } from "react";
import { EXPIRY_WARNING_SEC, type ShellState } from "@stillgate/shared";
import type { RestoreFailure } from "../common/api";
import logoUrl from "../../assets/logo.png";
import { api, formatClock } from "./api";
import { t } from "./strings";
import { Waves } from "./Waves";

// Flat square tiles in the style of the Windows 8 Start screen
// (no navy tile: it would disappear on the navy background)
const TILE_COLORS = ["#7b1e3a", "#2d6fb5", "#00788a", "#a4373a", "#3a7f4a", "#5c2d91", "#b04a1c", "#4a5f8a"];
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
      <BrandMark />
      {serviceDown && <p className="small-note">{t.locked.serviceDown}</p>}
    </div>
  );
}

// The product's signature, small in a corner of the kiosk screens
function BrandMark() {
  return <p className="brand-mark">{t.brand}</p>;
}

export function MaintenanceScreen() {
  return (
    <div className="screen locked">
      <div className="locked-content">
        <h1>{t.maintenance.title}</h1>
        <p className="big">{t.maintenance.detail}</p>
      </div>
      <BrandMark />
    </div>
  );
}

type LauncherProps = { readonly state: ShellState; readonly remainingSec: number };

// Tile sizes of the Windows 8 Start screen
const TILE = 150; // medium square tile
const GAP = 8;
const HEADER_AND_MARGINS = 230;

// How many tile rows fit on this screen (Windows 8 did the same: 3 rows at 768 px, more on taller screens)
function useTileRows(): number {
  const rowsFor = (height: number) => Math.max(2, Math.min(6, Math.floor((height - HEADER_AND_MARGINS) / (TILE + GAP))));
  const [rows, setRows] = useState(() => rowsFor(window.innerHeight));
  useEffect(() => {
    const update = () => setRows(rowsFor(window.innerHeight));
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return rows;
}

// Windows 8 Start screen: groups side by side, tiles filling columns top to bottom,
// the whole screen scrolls LEFT/RIGHT, and the mouse wheel scrolls sideways too.
export function Launcher({ state, remainingSec }: LauncherProps) {
  const [error, setError] = useState<string | null>(null);
  const rows = useTileRows();
  const run = async (open: () => Promise<{ ok: boolean }>) => {
    const result = await open();
    setError(result.ok ? null : t.launcher.failed);
  };
  const warn = remainingSec <= EXPIRY_WARNING_SEC;
  const scrollSideways = (event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY;
  };
  const gridStyle = { gridTemplateRows: `repeat(${rows}, ${TILE}px)` };
  let order = 0; // position in the fly-in animation

  return (
    <div className="screen launcher">
      <header>
        <div className="start-title">
          <img className="logo small" src={logoUrl} alt="American Space Dushanbe" />
        </div>
        <div className={`clock ${warn ? "warn" : ""}`}>
          <span>{t.launcher.timeLeft}</span>
          <strong>{formatClock(remainingSec)}</strong>
        </div>
      </header>
      {warn && <div className="banner">{t.launcher.warning}</div>}
      {error !== null && <div className="banner error">{error}</div>}
      {state.apps.length === 0 && state.sites.length === 0 ? (
        <p className="big start-empty">{t.launcher.empty}</p>
      ) : (
        <div className="start" onWheel={scrollSideways}>
          {state.apps.length > 0 && (
            <section className="group">
              <h2>{t.launcher.apps}</h2>
              <div className="group-tiles" style={gridStyle}>
                {state.apps.map((app, index) => (
                  <Tile key={app.id} name={app.name} color={tileColor(index)} size="medium" order={order++}
                    loadIcon={() => api.appIcon(app.id)} onOpen={() => void run(() => api.launchApp(app.id))} />
                ))}
              </div>
            </section>
          )}
          {state.sites.length > 0 && (
            <section className="group">
              <h2>{t.launcher.sites}</h2>
              <div className="group-tiles" style={gridStyle}>
                {state.sites.map((site, index) => (
                  <Tile key={site.id} name={site.name} color={tileColor(index + state.apps.length)} size="wide" order={order++}
                    loadIcon={() => api.siteIcon(site.id)} fallback="🌐" onOpen={() => void run(() => api.openSite(site.id))} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      <BrandMark />
    </div>
  );
}

type TileProps = {
  readonly name: string;
  readonly color: string | undefined;
  readonly size: "medium" | "wide";
  readonly order: number;
  readonly loadIcon: () => Promise<string | null>;
  readonly onOpen: () => void;
  readonly fallback?: string;
};

function Tile({ name, color, size, order, loadIcon, onOpen, fallback }: TileProps) {
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
    <button className={`tile ${size}`} style={{ backgroundColor: color, animationDelay: `${order * 45}ms` }} onClick={onOpen}>
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

