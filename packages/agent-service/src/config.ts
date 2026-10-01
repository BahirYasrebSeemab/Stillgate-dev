import { rename } from "node:fs/promises";
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
import { readJson, writeJsonAtomic, type Logger } from "@asd/shared/node";
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

// Holds the current config in memory and saves every change atomically.
// Changes are made by passing a function that returns a NEW config object (no mutation).
export class ConfigStore {
  private constructor(
    private current: AgentConfig,
    private readonly file: string,
  ) {}

  static async load(file: string, log: Logger): Promise<ConfigStore> {
    return new ConfigStore(await readConfigFile(file, log), file);
  }

  // Re-read the file (after the CLI changed it)
  async reload(log: Logger): Promise<void> {
    this.current = await readConfigFile(this.file, log);
  }

  get value(): AgentConfig {
    return this.current;
  }

  async update(change: (config: AgentConfig) => AgentConfig): Promise<AgentConfig> {
    const next = AgentConfig.parse(change(this.current));
    await writeJsonAtomic(this.file, next);
    this.current = next;
    return next;
  }
}

async function readConfigFile(file: string, log: Logger): Promise<AgentConfig> {
  const result = await readJson(file, AgentConfig);
  if (result.ok) return result.value;
  if (result.error.kind === "corrupt") {
    // Keep the broken file for inspection and start safe (unpaired, so nothing can unlock)
    const backup = `${file}.corrupt-${Date.now()}`;
    await rename(file, backup).catch(() => undefined);
    log.error("config_corrupt", { detail: result.error.detail, backup });
  }
  return DEFAULT_CONFIG;
}
