import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { LineSplitter, validate } from "@asd/shared";
import type { Logger } from "@asd/shared/node";
import { z } from "zod";
import { windowsToolPath } from "../windows/exec";

// Lists running processes with their path and owner.
//
// Measured on a real Windows 11 PC (2026-10-01):
//   - asking CIM/WMI for every process owner (GetOwner) took ~16 s  -> far too slow for a 2 s loop
//   - Get-Process -IncludeUserName takes ~0.17 s, BUT starting powershell.exe takes ~0.9 s
// So ONE PowerShell process is started once and kept running: each round we write "list" to its
// stdin and read back one JSON line. It needs admin rights for -IncludeUserName (the agent is SYSTEM).
// Traps handled:
//   - PowerShell prints in the old OEM code page, which turned "Администратор" into "?????????????"
//     -> the script switches its output to UTF-8 first
//   - ConvertTo-Json turns a one-item list into a plain object -> wrapped with @(...)
//   - process id 0 ("System Idle Process") exists -> ids may be 0
//   - user names come back as "COMPUTER\user" -> userName() strips the prefix

const LOOP_SCRIPT = [
  "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
  "$ProgressPreference = 'SilentlyContinue'",
  "$ErrorActionPreference = 'SilentlyContinue'",
  "while ($true) {",
  "  $line = [Console]::In.ReadLine()",
  "  if ($null -eq $line -or $line -eq 'exit') { break }",
  "  $list = Get-Process -IncludeUserName | ForEach-Object {",
  "    [pscustomobject]@{ pid = [int]$_.Id; name = [string]$_.ProcessName; path = $_.Path; user = $_.UserName }",
  "  }",
  "  [Console]::Out.WriteLine((ConvertTo-Json -InputObject @($list) -Compress))",
  "  [Console]::Out.Flush()",
  "}",
].join("\n");

const ENCODED_SCRIPT = Buffer.from(LOOP_SCRIPT, "utf16le").toString("base64");
const ANSWER_TIMEOUT_MS = 15_000;
const MAX_ANSWER_BYTES = 16 * 1024 * 1024;

export const ProcessInfo = z.object({
  pid: z.int().nonnegative(),
  name: z.string(),
  path: z.string().nullable(),
  user: z.string().nullable(),
});
export type ProcessInfo = z.infer<typeof ProcessInfo>;

const ProcessList = z.array(ProcessInfo);

export interface ProcessSource {
  list(): Promise<ProcessInfo[] | null>;
  close(): void;
}

// "DESKTOP-ABC\kiosk" -> "kiosk"
export function userName(owner: string | null): string | null {
  if (owner === null) return null;
  const index = owner.lastIndexOf("\\");
  return index === -1 ? owner : owner.slice(index + 1);
}

// UNTESTED(windows): only measured interactively so far, not yet inside the service (as SYSTEM).
export class PowerShellProcessSource implements ProcessSource {
  private child: ChildProcessWithoutNullStreams | null = null;
  private waiting: ((line: string | null) => void) | null = null;

  constructor(
    private readonly log: Logger,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  async list(): Promise<ProcessInfo[] | null> {
    if (this.platform !== "win32") return null;
    if (this.waiting !== null) return null; // previous round still running
    const child = this.child ?? this.start();
    const answer = await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        this.log.warn("process_list_timeout");
        this.restart();
        resolve(null);
      }, ANSWER_TIMEOUT_MS);
      this.waiting = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
      child.stdin.write("list\n");
    });
    this.waiting = null;
    return answer === null ? null : parseProcessList(answer, this.log);
  }

  close(): void {
    this.child?.stdin.end("exit\n");
    this.child?.kill();
    this.child = null;
  }

  private start(): ChildProcessWithoutNullStreams {
    const child = spawn(
      windowsToolPath("powershell"),
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", ENCODED_SCRIPT],
      { windowsHide: true },
    );
    const splitter = new LineSplitter(MAX_ANSWER_BYTES);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const { lines, overflow } = splitter.push(chunk);
      if (overflow) return this.restart();
      for (const line of lines) this.answer(line);
    });
    child.stderr.on("data", () => undefined); // PowerShell progress noise
    child.on("error", (error) => this.log.error("process_lister_error", { error }));
    child.on("exit", () => {
      if (this.child === child) this.child = null;
      this.answer(null);
    });
    this.child = child;
    this.log.info("process_lister_started");
    return child;
  }

  private answer(line: string | null): void {
    const waiting = this.waiting;
    this.waiting = null;
    waiting?.(line);
  }

  private restart(): void {
    const old = this.child;
    this.child = null;
    old?.kill();
  }
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
