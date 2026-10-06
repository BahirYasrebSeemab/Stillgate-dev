import { clipboard, ipcMain, type IpcMainInvokeEvent } from "electron";
import { DurationSec, MAX_NAME_CHARS, MAX_PASSWORD_CHARS, MachineId, describeZodError, err, ok } from "@stillgate/shared";
import { z } from "zod";
import type { InvokeChannel } from "../common/api";
import type { ManagerService } from "./service";
import { isTrustedSender } from "./window";

// IPC handlers: the ONLY doors from the UI into the main process.
// The UI is treated as untrusted input: every argument is validated with zod here.

const MachineCommand = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("unlock"), durationSec: DurationSec }),
  z.strictObject({ type: z.literal("extend"), durationSec: DurationSec }),
  z.strictObject({ type: z.literal("lock") }),
  z.strictObject({ type: z.literal("rearm") }),
  z.strictObject({ type: z.literal("power"), action: z.enum(["restart", "shutdown"]) }),
]);

const Ids = z.array(MachineId).min(1).max(50);
const Text = (max: number) => z.string().max(max);

export function registerIpc(service: ManagerService): void {
  handle("stillgate:snapshot", () => service.snapshot());

  handle("stillgate:command", (idsInput: unknown, commandInput: unknown) => {
    const ids = Ids.safeParse(idsInput);
    const command = MachineCommand.safeParse(commandInput);
    if (!ids.success) return err(describeZodError(ids.error));
    if (!command.success) return err(describeZodError(command.error));
    return ok(service.sendCommand(ids.data, command.data));
  });

  handle("stillgate:rename", (id: unknown, name: unknown) => {
    const parsedId = MachineId.safeParse(id);
    const parsedName = Text(MAX_NAME_CHARS).safeParse(name);
    if (!parsedId.success || !parsedName.success) return err("invalid input");
    return service.renameMachine(parsedId.data, parsedName.data);
  });

  handle("stillgate:revoke", (id: unknown) => {
    const parsedId = MachineId.safeParse(id);
    return parsedId.success ? service.revokeMachine(parsedId.data) : err("invalid input");
  });

  handle("stillgate:savePolicy", (policy: unknown) => service.savePolicy(policy));

  handle("stillgate:setPassword", (password: unknown, confirmation: unknown) => {
    const a = Text(MAX_PASSWORD_CHARS).safeParse(password);
    const b = Text(MAX_PASSWORD_CHARS).safeParse(confirmation);
    return a.success && b.success ? service.setPassword(a.data, b.data) : err("invalid input");
  });

  handle("stillgate:createPairing", (address: unknown) => {
    const parsed = Text(15).safeParse(address);
    return parsed.success ? service.createPairing(parsed.data) : err("invalid input");
  });

  handle("stillgate:copy", (text: unknown) => {
    const parsed = Text(1000).safeParse(text);
    if (parsed.success) clipboard.writeText(parsed.data);
  });
}

function handle(channel: InvokeChannel, run: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error("untrusted sender");
    return run(...args);
  });
}
