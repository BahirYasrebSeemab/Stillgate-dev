import {
  EDGE_APP_FOLDER,
  baseName,
  findAllowedApp,
  isUnderFolder,
  normalizeWinPath,
  type LockStateName,
  type Policy,
} from "@asd/shared";
import type { ProcessInfo } from "./processes";

// PURE decision: which of the kiosk user's processes must be closed right now.
// No Windows calls in here, so every rule is unit-tested.

// Programs under C:\Windows are normally left alone (Windows needs them),
// EXCEPT these, which give a visitor a way around the lockdown.
// explorer.exe is included because the kiosk shell replaces the desktop.
export const DENY_LIST: ReadonlySet<string> = new Set([
  "cmd.exe",
  "powershell.exe",
  "powershell_ise.exe",
  "pwsh.exe",
  "regedit.exe",
  "mmc.exe",
  "taskmgr.exe",
  "control.exe",
  "msconfig.exe",
  "wscript.exe",
  "cscript.exe",
  "mshta.exe",
  "wt.exe",
  "msiexec.exe",
  "explorer.exe",
]);

export type DecideInput = {
  readonly processes: readonly ProcessInfo[]; // already filtered to the kiosk user
  readonly state: LockStateName;
  readonly policy: Policy;
  readonly kioskShellDir: string; // our own shell and its helper processes
  readonly windowsDir: string;
};

export type KillDecision = { readonly pid: number; readonly path: string; readonly reason: string };

export function decideKills(input: DecideInput): KillDecision[] {
  if (input.state === "MAINTENANCE") return []; // the admin is working; enforcement is off

  const shellDir = normalizeWinPath(input.kioskShellDir);
  const windowsDir = normalizeWinPath(input.windowsDir);
  const edgeDir = normalizeWinPath(EDGE_APP_FOLDER);
  const unlocked = input.state === "UNLOCKED";
  const decisions: KillDecision[] = [];

  for (const process of input.processes) {
    const path = process.path === null ? null : normalizeWinPath(process.path);
    if (path === null) continue; // unknown location: cannot judge it, leave it alone

    const reason = killReason(path, { shellDir, windowsDir, edgeDir, unlocked, input });
    if (reason !== null) decisions.push({ pid: process.pid, path, reason });
  }
  return decisions;
}

type Context = {
  readonly shellDir: string | null;
  readonly windowsDir: string | null;
  readonly edgeDir: string | null;
  readonly unlocked: boolean;
  readonly input: DecideInput;
};

function killReason(path: string, ctx: Context): string | null {
  if (ctx.shellDir !== null && isUnderFolder(path, ctx.shellDir)) return null;
  if (DENY_LIST.has(baseName(path))) return "deny_list";
  if (ctx.windowsDir !== null && isUnderFolder(path, ctx.windowsDir)) return null;
  if (!ctx.unlocked) return "locked";
  if (findAllowedApp(path, ctx.input.policy.apps) !== null) return null;
  const sitesAllowed = ctx.input.policy.sites.length > 0;
  if (sitesAllowed && ctx.edgeDir !== null && isUnderFolder(path, ctx.edgeDir)) return null;
  return "not_allowed";
}
