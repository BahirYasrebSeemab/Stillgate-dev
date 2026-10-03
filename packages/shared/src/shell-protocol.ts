import { z } from "zod";
import { MAX_NAME_CHARS, MAX_PASSWORD_CHARS, MAX_SHELL_PUSH_BYTES, MAX_SHELL_REQUEST_BYTES } from "./constants";
import { AppId, Hex64, SiteId } from "./ids";
import { LockStateName } from "./protocol";
import type { Result } from "./result";
import { parseJsonMessage } from "./zod-util";

// Kiosk shell <-> agent messages: one JSON object per line over 127.0.0.1 TCP.
// The shell only ever sends ids, never paths or URLs.

const ReqId = z.int().nonnegative();
const Base = { token: Hex64, reqId: ReqId };

export const ShellRequest = z.discriminatedUnion("cmd", [
  z.strictObject({ ...Base, cmd: z.literal("getState") }),
  z.strictObject({ ...Base, cmd: z.literal("subscribe") }),
  z.strictObject({ ...Base, cmd: z.literal("launchApp"), appId: AppId }),
  z.strictObject({ ...Base, cmd: z.literal("openSite"), siteId: SiteId }),
  z.strictObject({ ...Base, cmd: z.literal("restore"), password: z.string().min(1).max(MAX_PASSWORD_CHARS) }),
]);
export type ShellRequest = z.infer<typeof ShellRequest>;

const Name = z.string().max(MAX_NAME_CHARS);

export const ShellState = z.strictObject({
  lock: LockStateName,
  remainingSec: z.int().nonnegative().nullable(),
  serverOnline: z.boolean(),
  apps: z.array(z.strictObject({ id: AppId, name: Name, exePath: z.string(), iconPath: z.string().optional() })),
  // url: where the site opens (also used to fetch its icon); visitors see it in Edge anyway
  sites: z.array(z.strictObject({ id: SiteId, name: Name, url: z.string().max(300) })),
});
export type ShellState = z.infer<typeof ShellState>;

export const ShellResult = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("state"), state: ShellState }),
  z.strictObject({ kind: z.literal("launch"), exePath: z.string(), args: z.array(z.string()) }),
  z.strictObject({ kind: z.literal("open"), url: z.string() }),
  z.strictObject({ kind: z.literal("restoring") }),
]);
export type ShellResult = z.infer<typeof ShellResult>;

export const ShellErrorCode = z.enum([
  "unauthorized",
  "bad_request",
  "not_allowed",
  "locked_out",
  "wrong_password",
  "no_password_set",
  "internal",
]);
export type ShellErrorCode = z.infer<typeof ShellErrorCode>;

export const AgentToShell = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("reply"), reqId: ReqId, result: ShellResult }),
  z.strictObject({
    type: z.literal("error"),
    reqId: ReqId,
    error: ShellErrorCode,
    retryAfterSec: z.int().nonnegative().optional(),
  }),
  z.strictObject({ type: z.literal("push"), state: ShellState }),
]);
export type AgentToShell = z.infer<typeof AgentToShell>;

export function parseShellRequest(line: string): Result<ShellRequest, string> {
  return parseJsonMessage(ShellRequest, line, MAX_SHELL_REQUEST_BYTES);
}

export function parseAgentToShell(line: string): Result<AgentToShell, string> {
  return parseJsonMessage(AgentToShell, line, MAX_SHELL_PUSH_BYTES);
}

// The file the agent writes at start and the kiosk shell reads to find and authenticate to it.
// UNTESTED(windows): the install script gives the kiosk user read access to this file only.
export const ShellTokenFile = z.strictObject({
  schemaVersion: z.literal(1),
  token: Hex64,
  port: z.int().min(1024).max(65535),
});
export type ShellTokenFile = z.infer<typeof ShellTokenFile>;
