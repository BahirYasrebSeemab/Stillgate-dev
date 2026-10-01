import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
import { AppId, MAX_PASSWORD_CHARS, SiteId, err, ok, type Result } from "@asd/shared";
import type { Logger } from "@asd/shared/node";
import { z } from "zod";
import type { InvokeChannel, KioskView, RestoreFailure } from "../common/api";
import type { AgentClient } from "./agent-client";
import { launchProgram, openInEdge } from "./launch";
import { isTrustedSender } from "./window";

// The UI can only send ids and the typed password. The agent decides whether they are allowed
// and answers with the real path/URL; only then does this process start anything.

const Password = z.string().min(1).max(MAX_PASSWORD_CHARS);

export function registerIpc(agent: AgentClient, view: () => KioskView, log: Logger): void {
  const icons = new Map<string, string | null>();

  handle("kiosk:view", () => view());

  handle("kiosk:launch", async (input: unknown): Promise<Result<true, string>> => {
    const id = AppId.safeParse(input);
    if (!id.success) return err("bad_request");
    const reply = await agent.request({ cmd: "launchApp", appId: id.data });
    if (reply === null) return err("service_unavailable");
    if (reply.type === "error" || reply.result.kind !== "launch") return err(reply.type === "error" ? reply.error : "internal");
    return launchProgram(reply.result.exePath, reply.result.args, log) ? ok(true) : err("launch_failed");
  });

  handle("kiosk:open", async (input: unknown): Promise<Result<true, string>> => {
    const id = SiteId.safeParse(input);
    if (!id.success) return err("bad_request");
    const reply = await agent.request({ cmd: "openSite", siteId: id.data });
    if (reply === null) return err("service_unavailable");
    if (reply.type === "error" || reply.result.kind !== "open") return err(reply.type === "error" ? reply.error : "internal");
    return openInEdge(reply.result.url, log) ? ok(true) : err("launch_failed");
  });

  // Icons are looked up only for apps the agent currently lists
  handle("kiosk:icon", async (input: unknown): Promise<string | null> => {
    const id = AppId.safeParse(input);
    const entry = id.success ? agent.state?.apps.find((a) => a.id === id.data) : undefined;
    if (entry === undefined) return null;
    const source = entry.iconPath ?? entry.exePath;
    if (!icons.has(source)) {
      const icon = await app.getFileIcon(source, { size: "large" }).catch(() => null);
      icons.set(source, icon === null || icon.isEmpty() ? null : icon.toDataURL());
    }
    return icons.get(source) ?? null;
  });

  handle("kiosk:restore", async (input: unknown): Promise<Result<true, RestoreFailure>> => {
    const password = Password.safeParse(input);
    if (!password.success) return err({ reason: "wrong_password" });
    const reply = await agent.request({ cmd: "restore", password: password.data });
    if (reply === null) return err({ reason: "service_unavailable" });
    if (reply.type === "reply") return ok(true);
    switch (reply.error) {
      case "locked_out":
        return err({ reason: "locked_out", retryAfterSec: reply.retryAfterSec ?? 60 });
      case "no_password_set":
        return err({ reason: "no_password_set" });
      default:
        return err({ reason: "wrong_password" });
    }
  });
}

function handle(channel: InvokeChannel, run: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error("untrusted sender");
    return run(...args);
  });
}
