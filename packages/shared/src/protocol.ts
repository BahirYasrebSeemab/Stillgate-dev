import { z } from "zod";
import { MAX_EVENT_DETAIL_CHARS, MAX_MESSAGE_BYTES, MAX_UNLOCK_SEC, MIN_UNLOCK_SEC } from "./constants";
import { Hex64, MachineId } from "./ids";
import { Policy } from "./policy";
import type { Result } from "./result";
import { parseJsonMessage } from "./zod-util";

// ---------- Building blocks ----------

export const LockStateName = z.enum(["LOCKED", "UNLOCKED", "MAINTENANCE"]);
export type LockStateName = z.infer<typeof LockStateName>;

export const EnforcementMode = z.enum(["audit", "enforce"]);
export type EnforcementMode = z.infer<typeof EnforcementMode>;

export const DurationSec = z.int().min(MIN_UNLOCK_SEC).max(MAX_UNLOCK_SEC);

const Version = z.string().regex(/^\d+\.\d+\.\d+$/);
const Counter = z.int().nonnegative();
const Base64 = z.base64().max(1024);

// A salted scrypt hash of the restore password. Never contains the password itself.
export const PasswordRecord = z.strictObject({
  algo: z.literal("scrypt"),
  salt: Base64,
  hash: Base64,
  params: z.strictObject({
    N: z.int().min(1024).max(2 ** 20),
    r: z.int().min(1).max(32),
    p: z.int().min(1).max(16),
    keylen: z.int().min(16).max(128),
  }),
  version: Counter,
});
export type PasswordRecord = z.infer<typeof PasswordRecord>;

// ---------- Agent -> server ----------

export const AgentToServer = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("hello"), protocol: z.int(), machineId: MachineId, agentVersion: Version }),
  z.strictObject({ type: z.literal("auth_response"), mac: Hex64 }),
  z.strictObject({
    type: z.literal("state_report"),
    state: LockStateName,
    remainingSec: Counter.nullable(),
    enforcement: EnforcementMode,
    dryRun: z.boolean(),
    passwordVersion: Counter,
    policyVersion: Counter,
    agentVersion: Version,
  }),
  z.strictObject({ type: z.literal("heartbeat") }),
  z.strictObject({
    type: z.literal("event"),
    kind: z.string().regex(/^[a-z_]{1,40}$/),
    detail: z.string().max(MAX_EVENT_DETAIL_CHARS),
    at: z.int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal("pair_request"),
    protocol: z.int(),
    code: z.string().regex(/^[A-Z0-9]{8}$/),
    hostname: z.string().min(1).max(63),
    agentVersion: Version,
  }),
]);
export type AgentToServer = z.infer<typeof AgentToServer>;

// ---------- Server -> agent ----------

export const ServerErrorCode = z.enum(["bad_message", "auth_failed", "pairing_failed", "protocol_mismatch"]);

export const ServerToAgent = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("auth_challenge"), nonce: Hex64 }),
  z.strictObject({ type: z.literal("auth_ok") }),
  z.strictObject({ type: z.literal("unlock"), durationSec: DurationSec }),
  z.strictObject({ type: z.literal("lock") }),
  z.strictObject({ type: z.literal("extend"), durationSec: DurationSec }),
  z.strictObject({ type: z.literal("rearm") }),
  z.strictObject({ type: z.literal("policy"), policy: Policy }),
  z.strictObject({ type: z.literal("password_update"), record: PasswordRecord }),
  z.strictObject({ type: z.literal("power"), action: z.enum(["restart", "shutdown"]) }),
  z.strictObject({
    type: z.literal("pair_result"),
    machineId: MachineId,
    secret: Hex64,
    password: PasswordRecord,
    policy: Policy,
  }),
  z.strictObject({ type: z.literal("error"), code: ServerErrorCode, message: z.string().max(200) }),
]);
export type ServerToAgent = z.infer<typeof ServerToAgent>;

// ---------- Parsers (the only way raw network text becomes a typed message) ----------

export function parseAgentMessage(raw: string): Result<AgentToServer, string> {
  return parseJsonMessage(AgentToServer, raw, MAX_MESSAGE_BYTES);
}

export function parseServerMessage(raw: string): Result<ServerToAgent, string> {
  return parseJsonMessage(ServerToAgent, raw, MAX_MESSAGE_BYTES);
}
