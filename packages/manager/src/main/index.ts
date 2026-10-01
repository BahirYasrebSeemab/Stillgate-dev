import { join } from "node:path";
import { Menu, Tray, app, nativeImage, type BrowserWindow } from "electron";
import { createLogger } from "@asd/shared/node";
import type { PushChannel } from "../common/api";
import { registerIpc } from "./ipc";
import { safeStorageBox } from "./secret-box";
import { ManagerService } from "./service";
import { openManagerStore } from "./store";
import { createManagerWindow } from "./window";

// Manager app entry. The main process runs the agent server; the window is only the UI.
// Closing the window hides it to the tray: the server keeps running until "Quit".

const PUSH: PushChannel = "asd:update";
const PUSH_THROTTLE_MS = 250;

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

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

  // Development only: ASD_SERVER_HOST=127.0.0.1 keeps the server off the network (no firewall pop-up)
  const devHost = app.isPackaged ? undefined : process.env["ASD_SERVER_HOST"];
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
  tray.setToolTip("ASD Lab Lock — Manager (server running)");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open manager", click: () => showWindow() },
      { type: "separator" },
      { label: "Quit (stops the server)", click: () => app.quit() },
    ]),
  );
  tray.on("double-click", () => showWindow());
}
