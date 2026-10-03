import { join } from "node:path";
import { BrowserWindow, app, session, shell } from "electron";

// The manager window, locked down like a kiosk page even though only staff use it:
// no Node in the page, sandboxed renderer, no navigation away, no new windows.

export const DEV_SERVER_URL = process.env["ASD_DEV_SERVER_URL"]; // set by `bun run dev`

export function createManagerWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "ASD Lab Lock — Manager",
    show: false,
    autoHideMenuBar: true,
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

  // The page may never navigate anywhere or open windows; real links go to the default browser
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  // The manager UI never needs camera, microphone, notifications, etc.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  window.once("ready-to-show", () => window.show());
  if (DEV_SERVER_URL !== undefined && !app.isPackaged) void window.loadURL(DEV_SERVER_URL);
  else void window.loadFile(join(__dirname, "..", "renderer", "index.html"));
  return window;
}

// IPC calls are only accepted from our own page (defense in depth)
export function isTrustedSender(frameUrl: string | undefined): boolean {
  if (frameUrl === undefined) return false;
  if (DEV_SERVER_URL !== undefined && !app.isPackaged && frameUrl.startsWith(DEV_SERVER_URL)) return true;
  return frameUrl.startsWith("file://") && frameUrl.includes("/renderer/index.html");
}
