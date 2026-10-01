import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { EnforcementMode } from "@asd/shared";
import { randomHex, readJson, writeJsonAtomic, type Logger } from "@asd/shared/node";
import { z } from "zod";

// How the admin CLI talks to the running service: it drops a small JSON "request" file
// into the control folder; the service checks the folder every second, acts, and deletes it.
// Only SYSTEM and Administrators can write there (folder ACL from the install script),
// and if the service is stopped the request simply waits until it starts.

export const ControlRequest = z.discriminatedUnion("cmd", [
  z.strictObject({ cmd: z.literal("rearm") }),
  z.strictObject({ cmd: z.literal("reload") }),
  z.strictObject({ cmd: z.literal("set-enforcement"), mode: EnforcementMode }),
  z.strictObject({ cmd: z.literal("set-dry-run"), value: z.boolean() }),
]);
export type ControlRequest = z.infer<typeof ControlRequest>;

let sequence = 0;

// File names sort in the order the requests were made (time, then a counter for the same millisecond)
export async function writeControlRequest(dir: string, request: ControlRequest): Promise<string> {
  sequence += 1;
  const file = join(dir, `${Date.now()}-${String(sequence).padStart(6, "0")}-${randomHex(2)}.json`);
  await writeJsonAtomic(file, request);
  return file;
}

export async function pendingControlRequests(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

export async function processControlRequests(
  dir: string,
  log: Logger,
  handle: (request: ControlRequest) => Promise<void>,
): Promise<number> {
  await mkdir(dir, { recursive: true });
  const names = await pendingControlRequests(dir);
  for (const name of names) {
    const file = join(dir, name);
    const result = await readJson(file, ControlRequest);
    await rm(file, { force: true });
    if (!result.ok) {
      log.warn("control_request_invalid", { file: name });
      continue;
    }
    log.info("control_request", { cmd: result.value.cmd });
    await handle(result.value);
  }
  return names.length;
}
