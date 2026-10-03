import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hasDebugSwitch } from "@asd/shared";
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

// Development captures only: keep painting even when other windows cover this one
// (otherwise Windows' occlusion tracking makes captures show an old frame)
if (process.env["ASD_DEV_CAPTURE_DIR"] !== undefined && !app.isPackaged) {
  app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
}

// Security: an installed copy never starts with a debugger / remote-control switch
if (app.isPackaged && hasDebugSwitch(process.argv)) app.exit(1);

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
    captureForDevelopment(state?.lock ?? "agent-unreachable");
  });

  window = createKioskWindow(log);
  agent.start();
  // Installed: never quit. Development windowed mode: closing the window ends the app.
  app.on("window-all-closed", () => {
    if (process.env["ASD_KIOSK_WINDOWED"] === "1" && !app.isPackaged) app.quit();
  });
  log.info("kiosk_shell_started", { agentDataDir: agentDataDir() });
}

// Development only: ASD_DEV_CAPTURE_DIR=<folder> saves a picture of THIS window (not the screen)
// shortly after every state change, so the UI can be checked without looking at the PC.
let captureCount = 0;
// It also writes the page's visible TEXT, which is reliable even when Windows has stopped
// repainting the window because other windows cover it.
function captureForDevelopment(label: string): void {
  const dir = process.env["ASD_DEV_CAPTURE_DIR"];
  if (dir === undefined || app.isPackaged) return;
  const name = `${String(++captureCount).padStart(2, "0")}-${label}`;
  setTimeout(() => {
    const contents = window?.webContents;
    if (contents === undefined) return;
    void contents.capturePage().then((image) => writeFile(join(dir, `${name}.png`), image.toPNG())).catch(() => undefined);
    void contents
      .executeJavaScript("document.body.innerText")
      .then((text: unknown) => writeFile(join(dir, `${name}.txt`), String(text), "utf8"))
      .catch(() => undefined);
  }, 1500);
}
