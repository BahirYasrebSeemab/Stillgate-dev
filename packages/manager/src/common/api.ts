// Types shared by the manager's main process, preload script and React UI.
// TYPES ONLY: the sandboxed preload may not load other files at runtime,
// so it imports this file with `import type` (erased when compiled).

import type { EnforcementMode, LockStateName, MachineId, Policy, Result } from "@asd/shared";

export type MachineView = {
  readonly id: MachineId;
  readonly name: string;
  readonly hostname: string;
  readonly online: boolean;
  readonly state: LockStateName | null; // null = never reported
  readonly remainingSec: number | null; // at the moment `takenAt` of the snapshot
  readonly lastSeen: number | null;
  readonly dryRun: boolean | null;
  readonly enforcement: EnforcementMode | null;
  readonly agentVersion: string | null;
  readonly passwordSynced: boolean;
  readonly policySynced: boolean;
};

export type EventView = {
  readonly at: number;
  readonly machineName: string | null;
  readonly kind: string;
  readonly detail: string;
};

export type ServerView = {
  readonly listening: boolean;
  readonly port: number;
  readonly fingerprint: string | null;
  readonly addresses: readonly string[];
  readonly error: string | null;
};

export type Snapshot = {
  readonly takenAt: number;
  readonly machines: readonly MachineView[];
  readonly policy: Policy;
  readonly password: { readonly set: boolean; readonly version: number };
  readonly server: ServerView;
  readonly events: readonly EventView[];
};

export type MachineCommand =
  | { readonly type: "unlock"; readonly durationSec: number }
  | { readonly type: "extend"; readonly durationSec: number }
  | { readonly type: "lock" }
  | { readonly type: "rearm" }
  | { readonly type: "power"; readonly action: "restart" | "shutdown" };

export type CommandOutcome = { readonly id: MachineId; readonly delivered: boolean };

export type PairingOffer = { readonly pairingString: string; readonly expiresAt: number };

// The API the preload script exposes to the UI as window.asd
export interface ManagerApi {
  getSnapshot(): Promise<Snapshot>;
  onUpdate(listener: (snapshot: Snapshot) => void): () => void;
  sendCommand(ids: readonly MachineId[], command: MachineCommand): Promise<Result<CommandOutcome[], string>>;
  renameMachine(id: MachineId, name: string): Promise<Result<true, string>>;
  revokeMachine(id: MachineId): Promise<Result<true, string>>;
  savePolicy(policy: unknown): Promise<Result<Policy, string>>;
  setPassword(password: string, confirmation: string): Promise<Result<true, string>>;
  createPairing(address: string): Promise<Result<PairingOffer, string>>;
  copyText(text: string): Promise<void>;
}

// IPC channel names (string literal types, checked at compile time on both sides)
export type InvokeChannel =
  | "asd:snapshot"
  | "asd:command"
  | "asd:rename"
  | "asd:revoke"
  | "asd:savePolicy"
  | "asd:setPassword"
  | "asd:createPairing"
  | "asd:copy";
export type PushChannel = "asd:update";
