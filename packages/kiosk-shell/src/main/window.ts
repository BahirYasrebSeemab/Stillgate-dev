import { join } from "node:path";
import { BrowserWindow, app, screen, session, type Input } from "electron";
import type { Logger } from "@asd/shared/node";

// The kiosk window: full screen, no frame, cannot be closed, cannot navigate anywhere.
// Visitors can attack this window, so it gets no power: sandboxed, no Node, and every
// privileged action goes through the agent.

export const DEV_SERVER_URL = process.env["ASD_DEV_SERVER_URL"];
// Development only: a normal, closable window instead of the full-screen kiosk (ignored when installed)
const WINDOWED = process.env["ASD_KIOSK_WINDOWED"] === "1" && !app.isPackaged;

// Shortcuts that would reload the page, open DevTools, zoom or close things
const BLOCKED_KEYS = new Set(["F5", "F11", "F12"]);
const BLOCKED_CTRL_KEYS = new Set(["r", "w", "q", "n", "t", "p", "s", "o", "+", "-", "=", "0", "i", "j", "u"]);

export function createKioskWindow(log: Logger): BrowserWindow {
  // Kiosk: start exactly the size of the screen. Development window: 1280 x 800.
  const bounds = WINDOWED ? { width: 1280, height: 800 } : screen.getPrimaryDisplay().bounds;
  const window = new BrowserWindow({
    ...bounds,
    show: false,
    frame: WINDOWED,
    fullscreen: !WINDOWED,
    fullscreenable: true,
    kiosk: !WINDOWED,
    alwaysOnTop: !WINDOWED,
    closable: WINDOWED,
    minimizable: WINDOWED,
    // Must stay resizable: on Windows a non-resizable window can refuse to go full screen
    // (seen on the first real test PC: the kiosk opened as a plain window).
    resizable: true,
    movable: WINDOWED,
    skipTaskbar: !WINDOWED,
    backgroundColor: "#0f2238",
    webPreferences: {
      preload: join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
      spellcheck: false,
    },
  });
  window.removeMenu();

  const contents = window.webContents;
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("before-input-event", (event, input) => {
    if (isBlocked(input)) event.preventDefault();
  });
  contents.on("zoom-changed", () => contents.setZoomFactor(1));
  void contents.setVisualZoomLevelLimits(1, 1);
  // A crashed page must come back by itself (there is no desktop to fall back to)
  contents.on("render-process-gone", () => contents.reload());
  // The page never needs camera, microphone, notifications, etc.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  // Alt+F4 does nothing... except when Windows itself is restarting or shutting down:
  // then we must close, or we would block the restart that maintenance mode depends on.
  // UNTESTED(windows): the session-end events.
  let sessionEnding = false;
  window.on("query-session-end", () => (sessionEnding = true));
  window.on("session-end", () => {
    sessionEnding = true;
    app.exit(0);
  });
  window.on("close", (event) => {
    if (!sessionEnding && !WINDOWED) event.preventDefault();
  });
  // On Windows, full screen / kiosk requested while the window was still hidden can be ignored,
  // so switch them on again right after showing it, and come back if anything leaves them.
  const enforceKiosk = (): void => {
    if (WINDOWED || window.isDestroyed()) return;
    if (!window.isKiosk()) window.setKiosk(true);
    if (!window.isFullScreen()) window.setFullScreen(true);
  };
  window.once("ready-to-show", () => {
    window.show();
    enforceKiosk();
    window.focus();
    setTimeout(() => {
      enforceKiosk();
      log.info("kiosk_window", { fullScreen: window.isFullScreen(), kiosk: window.isKiosk(), bounds: window.getBounds() });
    }, 1000);
  });
  window.on("leave-full-screen", () => setTimeout(enforceKiosk, 100));
  window.on("restore", () => setTimeout(enforceKiosk, 100));

  if (DEV_SERVER_URL !== undefined && !app.isPackaged) void window.loadURL(DEV_SERVER_URL);
  else void window.loadFile(join(__dirname, "..", "renderer", "index.html"));
  return window;
}

function isBlocked(input: Input): boolean {
  if (input.type !== "keyDown") return false;
  if (BLOCKED_KEYS.has(input.key)) return true;
  if ((input.control || input.meta) && BLOCKED_CTRL_KEYS.has(input.key.toLowerCase())) return true;
  return input.alt && input.key === "F4";
}

export function isTrustedSender(frameUrl: string | undefined): boolean {
  if (frameUrl === undefined) return false;
  if (DEV_SERVER_URL !== undefined && !app.isPackaged && frameUrl.startsWith(DEV_SERVER_URL)) return true;
  return frameUrl.startsWith("file://") && frameUrl.includes("/renderer/index.html");
}
