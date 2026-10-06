import { join } from "node:path";
import {
  DEFAULT_SERVER_PORT,
  EMPTY_POLICY,
  Hex64,
  MAX_EVENT_DETAIL_CHARS,
  MAX_EVENT_LOG_ENTRIES,
  MAX_NAME_CHARS,
  MachineId,
  PasswordRecord,
  Policy,
} from "@stillgate/shared";
import { JsonFileStore, type Logger } from "@stillgate/shared/node";
import { z } from "zod";

// The manager's data, as three JSON files in its user-data folder.
// Secrets inside are SEALED (encrypted with the SecretBox) before they are stored.

export const MachineRecord = z.strictObject({
  id: MachineId,
  name: z.string().trim().min(1).max(MAX_NAME_CHARS),
  hostname: z.string().max(63),
  sealedSecret: z.string(),
  pairedAt: z.int(),
  lastSeen: z.int().nullable(),
  // Versions the agent last reported, so "synced / pending" also shows for offline PCs
  lastPasswordVersion: z.int().nonnegative().default(0),
  lastPolicyVersion: z.int().nonnegative().default(0),
});
export type MachineRecord = z.infer<typeof MachineRecord>;

const MachinesFile = z.strictObject({ schemaVersion: z.literal(1), machines: z.array(MachineRecord) });

const TlsRecord = z.strictObject({ certPem: z.string(), sealedKey: z.string(), fingerprint: Hex64 });

const SettingsFile = z.strictObject({
  schemaVersion: z.literal(1),
  serverPort: z.int().min(1024).max(65535).default(DEFAULT_SERVER_PORT),
  policy: Policy.default(EMPTY_POLICY),
  password: PasswordRecord.nullable().default(null),
  tls: TlsRecord.nullable().default(null),
});
export type Settings = z.infer<typeof SettingsFile>;

export const EventEntry = z.strictObject({
  at: z.int(),
  machineId: MachineId.nullable(),
  kind: z.string().max(40),
  detail: z.string().max(MAX_EVENT_DETAIL_CHARS),
});
export type EventEntry = z.infer<typeof EventEntry>;

const EventsFile = z.strictObject({ schemaVersion: z.literal(1), events: z.array(EventEntry) });

export type ManagerStore = {
  readonly machines: JsonFileStore<typeof MachinesFile>;
  readonly settings: JsonFileStore<typeof SettingsFile>;
  readonly events: JsonFileStore<typeof EventsFile>;
};

export async function openManagerStore(dataDir: string, log: Logger): Promise<ManagerStore> {
  return {
    machines: await JsonFileStore.open(join(dataDir, "machines.json"), MachinesFile, { schemaVersion: 1, machines: [] }, log),
    settings: await JsonFileStore.open(join(dataDir, "settings.json"), SettingsFile, SettingsFile.parse({ schemaVersion: 1 }), log),
    events: await JsonFileStore.open(join(dataDir, "events.json"), EventsFile, { schemaVersion: 1, events: [] }, log),
  };
}

// Adds an event and keeps only the newest MAX_EVENT_LOG_ENTRIES
export async function appendEvent(store: ManagerStore, entry: EventEntry): Promise<void> {
  await store.events.update((file) => ({
    ...file,
    events: [...file.events, entry].slice(-MAX_EVENT_LOG_ENTRIES),
  }));
}
