import {
  DEFAULT_SHELL_IPC_PORT,
  EMPTY_POLICY,
  EnforcementMode,
  Hex64,
  MachineId,
  PasswordRecord,
  Policy,
  isIPv4,
} from "@asd/shared";
import { JsonFileStore, type Logger } from "@asd/shared/node";
import { z } from "zod";

export const KioskConfig = z.strictObject({
  user: z.string().regex(/^[A-Za-z0-9._ -]{1,20}$/),
  sid: z.string().regex(/^S-1-5-21-\d+-\d+-\d+-\d+$/),
  shellExe: z.string().min(3).max(260),
});
export type KioskConfig = z.infer<typeof KioskConfig>;

export const ServerConfig = z.strictObject({
  host: z.string().refine(isIPv4, "must be an IPv4 address"),
  port: z.int().min(1).max(65535),
  fingerprint: Hex64,
});
export type ServerConfig = z.infer<typeof ServerConfig>;

// The agent's config file. The two safety switches default to the SAFE value:
// dryRun = true (Windows changes are only logged), enforcement = "audit" (nothing is killed).
export const AgentConfig = z.strictObject({
  schemaVersion: z.literal(1),
  dryRun: z.boolean().default(true),
  enforcement: EnforcementMode.default("audit"),
  shellIpcPort: z.int().min(1024).max(65535).default(DEFAULT_SHELL_IPC_PORT),
  kiosk: KioskConfig.optional(),
  server: ServerConfig.optional(),
  machineId: MachineId.optional(),
  secret: Hex64.optional(),
  password: PasswordRecord.optional(),
  policy: Policy.default(EMPTY_POLICY),
});
export type AgentConfig = z.infer<typeof AgentConfig>;

export const DEFAULT_CONFIG: AgentConfig = AgentConfig.parse({ schemaVersion: 1 });

// Everything needed to talk to the server; present only after pairing
export type Pairing = { server: ServerConfig; machineId: MachineId; secret: string };

export function pairingOf(config: AgentConfig): Pairing | null {
  const { server, machineId, secret } = config;
  return server && machineId && secret ? { server, machineId, secret } : null;
}

// The config file store: in memory + atomic saves (see JsonFileStore in @asd/shared/node).
// A corrupt config is moved aside and the agent starts unpaired, so nothing can unlock.
export type ConfigStore = JsonFileStore<typeof AgentConfig>;

export const ConfigStore = {
  load: (file: string, log: Logger): Promise<ConfigStore> => JsonFileStore.open(file, AgentConfig, DEFAULT_CONFIG, log),
};
