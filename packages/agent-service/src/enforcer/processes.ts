import { validate } from "@asd/shared";
import type { Logger } from "@asd/shared/node";
import { z } from "zod";
import type { Exec } from "../windows/exec";

// Lists running processes with their owner, using PowerShell + CIM (WMI).
// The script is a fixed string (no user input) and is passed base64-encoded via
// -EncodedCommand, so no quoting problems are possible.
// Traps handled:
//   - ConvertTo-Json turns a one-item list into a plain object -> wrapped with @(...) to stay an array
//   - protected processes have no ExecutablePath (null)
// UNTESTED(windows): run time of GetOwner for every process; measure on a real PC.

const SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "$list = Get-CimInstance Win32_Process | ForEach-Object {",
  "  $owner = Invoke-CimMethod -InputObject $_ -MethodName GetOwner",
  "  [pscustomobject]@{ pid = [int]$_.ProcessId; name = [string]$_.Name; path = $_.ExecutablePath; user = $owner.User }",
  "}",
  "ConvertTo-Json -InputObject @($list) -Compress",
].join("\n");

const ENCODED_SCRIPT = Buffer.from(SCRIPT, "utf16le").toString("base64");

export const ProcessInfo = z.object({
  pid: z.int().positive(),
  name: z.string(),
  path: z.string().nullable(),
  user: z.string().nullable(),
});
export type ProcessInfo = z.infer<typeof ProcessInfo>;

const ProcessList = z.array(ProcessInfo);

export async function listProcesses(exec: Exec, log: Logger): Promise<ProcessInfo[] | null> {
  const result = await exec.run(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", ENCODED_SCRIPT],
    { mutates: false, timeoutMs: 20_000 },
  );
  if (result.code !== 0) {
    log.warn("process_list_failed", { detail: result.stderr.slice(0, 300) });
    return null;
  }
  return parseProcessList(result.stdout, log);
}

export function parseProcessList(stdout: string, log: Logger): ProcessInfo[] | null {
  let data: unknown;
  try {
    data = JSON.parse(stdout.trim() || "[]");
  } catch {
    log.warn("process_list_not_json");
    return null;
  }
  const parsed = validate(ProcessList, data);
  if (!parsed.ok) {
    log.warn("process_list_invalid", { detail: parsed.error });
    return null;
  }
  return parsed.value;
}
