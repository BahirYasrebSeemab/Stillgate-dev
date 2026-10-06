import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hasDebugSwitch } from "@stillgate/shared";
import { Menu, Tray, app, nativeImage, type BrowserWindow } from "electron";
import { createLogger } from "@stillgate/shared/node";
import type { PushChannel } from "../common/api";
import { registerIpc } from "./ipc";
import { safeStorageBox } from "./secret-box";
import { ManagerService } from "./service";
import { openManagerStore } from "./store";
import { createManagerWindow } from "./window";

// Manager app entry. The main process runs the agent server; the window is only the UI.
// Closing the window hides it to the tray: the server keeps running until "Quit".

const PUSH: PushChannel = "stillgate:update";
const PUSH_THROTTLE_MS = 250;

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

// Security: an installed copy never starts with a debugger / remote-control switch
if (app.isPackaged && hasDebugSwitch(process.argv)) app.exit(1);

if (!app.requestSingleInstanceLock()) {
  app.quit(); // a second copy would fight over the server port
} else {
  app.on("second-instance", () => showWindow());
  app.whenReady().then(start).catch((error: unknown) => {
    process.stderr.write(`manager failed to start: ${String(error)}\n`);
    app.exit(1);
  });
}

async function start(): Promise<void> {
  const dataDir = app.getPath("userData");
  const log = createLogger({ file: join(dataDir, "logs", "manager.log"), echo: !app.isPackaged });
  const store = await openManagerStore(dataDir, log);
  const service = new ManagerService(store, safeStorageBox(), log);

  registerIpc(service);
  let pending: NodeJS.Timeout | null = null;
  service.on("changed", () => {
    if (pending !== null) return;
    pending = setTimeout(() => {
      pending = null;
      window?.webContents.send(PUSH, service.snapshot());
    }, PUSH_THROTTLE_MS);
  });

  // Development only: STILLGATE_SERVER_HOST=127.0.0.1 keeps the server off the network (no firewall pop-up)
  const devHost = app.isPackaged ? undefined : process.env["STILLGATE_SERVER_HOST"];
  await service.start(devHost);
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true }); // start with Windows
  createTray();
  showWindow();

  app.on("before-quit", () => {
    quitting = true;
    void service.stop();
  });
  app.on("window-all-closed", () => undefined); // keep running in the tray
  log.info("manager_started", { dataDir });
}

function showWindow(): void {
  if (window === null || window.isDestroyed()) {
    window = createManagerWindow();
    captureForDevelopment(window);
    window.on("close", (event) => {
      if (quitting) return;
      event.preventDefault();
      window?.hide();
    });
  }
  window.show();
  window.focus();
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(__dirname, "..", "..", "assets", "tray.png"));
  tray = new Tray(icon);
  tray.setToolTip("Stillgate Manager (server running)");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open manager", click: () => showWindow() },
      { type: "separator" },
      { label: "Quit (stops the server)", click: () => app.quit() },
    ]),
  );
  tray.on("double-click", () => showWindow());
}

// Development only: STILLGATE_DEV_CAPTURE_DIR=<folder> saves a picture + the text of THIS window
// a few seconds after it loads (to check the UI without looking at the screen).
function captureForDevelopment(target: BrowserWindow): void {
  const dir = process.env["STILLGATE_DEV_CAPTURE_DIR"];
  if (dir === undefined || app.isPackaged) return;
  target.webContents.once("did-finish-load", () => {
    setTimeout(() => {
      void target.webContents.capturePage().then((image) => writeFile(join(dir, "manager.png"), image.toPNG())).catch(() => undefined);
      void target.webContents
        .executeJavaScript("document.body.innerText")
        .then((text: unknown) => writeFile(join(dir, "manager.txt"), String(text), "utf8"))
        .catch(() => undefined);
    }, 3000);
  });
}
