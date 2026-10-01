import { join } from "node:path";
import { app, type BrowserWindow } from "electron";
import { agentDataDir, createLogger, shellTokenFile } from "@asd/shared/node";
import type { KioskView, PushChannel } from "../common/api";
import { AgentClient } from "./agent-client";
import { registerIpc } from "./ipc";
import { createKioskWindow } from "./window";

// Kiosk shell entry. On the visitor PCs this program IS the Windows shell for the kiosk user
// (it replaces Explorer), so it must never quit and must survive its own page crashing.
// UNTESTED(windows): running as the Winlogon "Shell" of a standard user.

const PUSH: PushChannel = "kiosk:update";

let window: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(start).catch((error: unknown) => {
    process.stderr.write(`kiosk shell failed to start: ${String(error)}\n`);
  });
}

function start(): void {
  // The kiosk user can't write to ProgramData, so the shell logs into its own profile folder
  const log = createLogger({ file: join(app.getPath("userData"), "logs", "kiosk-shell.log"), echo: !app.isPackaged });
  const agent = new AgentClient(shellTokenFile(), log);
  let view: KioskView = { state: null, receivedAt: Date.now() };

  registerIpc(agent, () => view, log);
  agent.on("state", (state) => {
    view = { state, receivedAt: Date.now() };
    // Locked (or agent unreachable): stay on top of everything. Unlocked: let launched apps show.
    const unlocked = state?.lock === "UNLOCKED";
    if (process.env["ASD_KIOSK_WINDOWED"] !== "1" || app.isPackaged) window?.setAlwaysOnTop(!unlocked, "screen-saver");
    if (!unlocked) window?.focus();
    window?.webContents.send(PUSH, view);
  });

  window = createKioskWindow();
  agent.start();
  // Installed: never quit. Development windowed mode: closing the window ends the app.
  app.on("window-all-closed", () => {
    if (process.env["ASD_KIOSK_WINDOWED"] === "1" && !app.isPackaged) app.quit();
  });
  log.info("kiosk_shell_started", { agentDataDir: agentDataDir() });
}
