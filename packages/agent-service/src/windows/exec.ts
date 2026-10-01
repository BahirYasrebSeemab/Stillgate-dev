import { execFile } from "node:child_process";
import { win32 } from "node:path";
import type { Logger } from "@asd/shared/node";

// The ONLY Windows programs the agent may run, always by absolute path under System32
// (never via PATH, so a planted "reg.exe" elsewhere can't be picked up).
export const WINDOWS_TOOLS = {
  reg: "reg.exe",
  shutdown: "shutdown.exe",
  taskkill: "taskkill.exe",
  icacls: "icacls.exe",
  powershell: "WindowsPowerShell\\v1.0\\powershell.exe",
} as const;
export type WindowsTool = keyof typeof WINDOWS_TOOLS;

export type ExecResult = { readonly code: number; readonly stdout: string; readonly stderr: string };

export type RunOptions = {
  // true for commands that CHANGE the machine (registry writes, restart, kill).
  // In dry-run mode these are only logged, never executed.
  readonly mutates: boolean;
  readonly timeoutMs?: number;
};

export interface Exec {
  run(tool: WindowsTool, args: readonly string[], options: RunOptions): Promise<ExecResult>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const NOT_WINDOWS: ExecResult = { code: -1, stdout: "", stderr: "not running on Windows" };
const DRY_RUN_OK: ExecResult = { code: 0, stdout: "", stderr: "" };

export type ExecOptions = {
  readonly dryRun: () => boolean; // read live, so a config change takes effect immediately
  readonly log: Logger;
  readonly platform?: NodeJS.Platform;
  readonly systemRoot?: string;
};

// Absolute path of an allowed tool, e.g. C:\Windows\System32\reg.exe
export function windowsToolPath(tool: WindowsTool, systemRoot = process.env["SystemRoot"] ?? "C:\\Windows"): string {
  return win32.join(systemRoot, "System32", WINDOWS_TOOLS[tool]);
}

export function createExec(options: ExecOptions): Exec {
  const platform = options.platform ?? process.platform;
  const systemRoot = options.systemRoot ?? process.env["SystemRoot"] ?? "C:\\Windows";

  return {
    async run(tool, args, runOptions) {
      if (runOptions.mutates && options.dryRun()) {
        options.log.info("dry_run", { tool, args });
        return DRY_RUN_OK;
      }
      if (platform !== "win32") return NOT_WINDOWS;
      const file = windowsToolPath(tool, systemRoot);
      return runFile(file, args, runOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    },
  };
}

// execFile with an ARGUMENT ARRAY: no shell is involved, so no argument can inject commands
function runFile(file: string, args: readonly string[], timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, encoding: "utf8" },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : -1;
        resolve({ code, stdout, stderr: stderr || (error?.message ?? "") });
      },
    );
  });
}
