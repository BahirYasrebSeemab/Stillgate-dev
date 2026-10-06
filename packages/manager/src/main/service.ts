import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { networkInterfaces } from "node:os";
import {
  MachineId,
  Policy,
  checkNewPassword,
  describeZodError,
  encodePairing,
  err,
  errorMessage,
  ok,
  type Result,
  type ServerToAgent,
} from "@stillgate/shared";
import { hashPassword, randomHex, type Logger } from "@stillgate/shared/node";
import type { CommandOutcome, MachineCommand, MachineView, PairingOffer, Snapshot } from "../common/api";
import type { SecretBox } from "./secret-box";
import { AgentServer, type AgentEvent, type PairReply, type PairRequest, type StateReport } from "./server/agent-server";
import { AuthLimiter, PairingCodes } from "./server/guards";
import { ensureCertificate } from "./server/tls";
import { appendEvent, type ManagerStore, type MachineRecord } from "./store";

// The manager's "brain": stored data + live agent connections + every action the UI can take.
// The UI never touches the network or files directly; it only calls methods here (via IPC).

const EVENTS_IN_SNAPSHOT = 200;

type LiveReport = { readonly report: StateReport; readonly receivedAt: number };
type ServiceEvents = { changed: [] };

export class ManagerService extends EventEmitter<ServiceEvents> {
  private server: AgentServer | null = null;
  private fingerprint: string | null = null;
  private listenPort = 0;
  private serverError: string | null = null;
  private readonly reports = new Map<MachineId, LiveReport>();
  private readonly codes = new PairingCodes();
  private readonly limiter = new AuthLimiter();

  constructor(
    private readonly store: ManagerStore,
    private readonly box: SecretBox,
    private readonly log: Logger,
    private readonly now: () => number = Date.now,
    private readonly addresses: () => string[] = localIPv4Addresses,
  ) {
    super();
  }

  async start(host = "0.0.0.0"): Promise<void> {
    try {
      const tls = await ensureCertificate(this.store, this.box, this.log);
      this.fingerprint = tls.fingerprint;
      const server = new AgentServer({
        log: this.log,
        key: tls.key,
        cert: tls.cert,
        port: this.store.settings.value.serverPort,
        host,
        limiter: this.limiter,
        now: this.now,
        secretOf: (id) => this.secretOf(id),
        onPair: (request, ip) => this.pair(request, ip),
        onOnline: (id, ip) => this.record(id, "online", `connected from ${ip}`),
        onReport: (id, report) => this.onReport(id, report),
        onEvent: (id, event) => this.onAgentEvent(id, event),
        onOffline: (id) => this.onOffline(id),
      });
      this.listenPort = await server.start();
      this.server = server;
      this.log.info("server_listening", { port: this.listenPort });
    } catch (error) {
      this.serverError = errorMessage(error);
      this.log.error("server_start_failed", { error });
    }
    this.changed();
  }

  async stop(): Promise<void> {
    await this.server?.stop();
  }

  // ---------- Snapshot for the UI ----------

  snapshot(): Snapshot {
    const settings = this.store.settings.value;
    const names = new Map(this.store.machines.value.machines.map((m) => [m.id, m.name]));
    return {
      takenAt: this.now(),
      machines: this.store.machines.value.machines.map((machine) => this.view(machine)),
      policy: settings.policy,
      password: { set: settings.password !== null, version: settings.password?.version ?? 0 },
      server: {
        listening: this.server !== null,
        port: this.listenPort || settings.serverPort,
        fingerprint: this.fingerprint,
        addresses: this.addresses(),
        error: this.serverError,
      },
      events: this.store.events.value.events
        .slice(-EVENTS_IN_SNAPSHOT)
        .reverse()
        .map((event) => ({
          at: event.at,
          machineName: event.machineId === null ? null : (names.get(event.machineId) ?? event.machineId),
          kind: event.kind,
          detail: event.detail,
        })),
    };
  }

  private view(machine: MachineRecord): MachineView {
    const live = this.reports.get(machine.id);
    const settings = this.store.settings.value;
    const elapsedSec = live === undefined ? 0 : Math.floor((this.now() - live.receivedAt) / 1000);
    const remaining = live?.report.remainingSec ?? null;
    return {
      id: machine.id,
      name: machine.name,
      hostname: machine.hostname,
      online: this.server?.isOnline(machine.id) ?? false,
      state: live?.report.state ?? null,
      remainingSec: remaining === null ? null : Math.max(0, remaining - elapsedSec),
      lastSeen: machine.lastSeen,
      dryRun: live?.report.dryRun ?? null,
      enforcement: live?.report.enforcement ?? null,
      agentVersion: live?.report.agentVersion ?? null,
      passwordSynced: machine.lastPasswordVersion >= (settings.password?.version ?? 0),
      policySynced: machine.lastPolicyVersion >= settings.policy.version,
    };
  }

  // ---------- Actions from the UI ----------

  sendCommand(ids: readonly MachineId[], command: MachineCommand): CommandOutcome[] {
    const message: ServerToAgent = command;
    return ids.map((id) => {
      const delivered = this.server?.send(id, message) ?? false;
      void this.record(id, "command", `${describeCommand(command)}${delivered ? "" : " (PC offline, not sent)"}`);
      return { id, delivered };
    });
  }

  async renameMachine(id: MachineId, name: string): Promise<Result<true, string>> {
    const clean = name.trim();
    if (clean === "" || clean.length > 80) return err("name must be 1-80 characters");
    if (!this.findMachine(id)) return err("unknown machine");
    await this.store.machines.update((file) => ({
      ...file,
      machines: file.machines.map((m) => (m.id === id ? { ...m, name: clean } : m)),
    }));
    this.changed();
    return ok(true);
  }

  // Forgets a PC: its secret is deleted, so it can never log in again (re-pair to bring it back)
  async revokeMachine(id: MachineId): Promise<Result<true, string>> {
    const machine = this.findMachine(id);
    if (!machine) return err("unknown machine");
    await this.store.machines.update((file) => ({ ...file, machines: file.machines.filter((m) => m.id !== id) }));
    this.server?.disconnect(id);
    this.reports.delete(id);
    await this.record(null, "revoked", `${machine.name} was removed`);
    return ok(true);
  }

  async savePolicy(input: unknown): Promise<Result<Policy, string>> {
    const current = this.store.settings.value.policy;
    const candidate = typeof input === "object" && input !== null ? { ...input, version: current.version + 1 } : input;
    const parsed = Policy.safeParse(candidate);
    if (!parsed.success) return err(describeZodError(parsed.error));
    await this.store.settings.update((settings) => ({ ...settings, policy: parsed.data }));
    this.broadcast({ type: "policy", policy: parsed.data });
    await this.record(null, "policy", `allow-list saved (version ${parsed.data.version})`);
    return ok(parsed.data);
  }

  async setPassword(password: string, confirmation: string): Promise<Result<true, string>> {
    const checked = checkNewPassword(password, confirmation);
    if (!checked.ok) return checked;
    const version = (this.store.settings.value.password?.version ?? 0) + 1;
    const record = await hashPassword(checked.value, version);
    await this.store.settings.update((settings) => ({ ...settings, password: record }));
    this.broadcast({ type: "password_update", record });
    await this.record(null, "password", `restore password changed (version ${version})`);
    return ok(true);
  }

  createPairing(address: string): Result<PairingOffer, string> {
    if (this.store.settings.value.password === null) return err("set the restore password before pairing a PC");
    if (this.server === null || this.fingerprint === null) return err("the server is not running");
    if (!this.addresses().includes(address)) return err("choose one of this PC's network addresses");
    const { code, expiresAt } = this.codes.create(this.now());
    const pairingString = encodePairing({ ip: address, port: this.listenPort, fingerprint: this.fingerprint, code });
    return ok({ pairingString, expiresAt });
  }

  // ---------- Agent callbacks ----------

  private secretOf(id: MachineId): string | null {
    const machine = this.findMachine(id);
    if (!machine) return null;
    try {
      return this.box.open(machine.sealedSecret);
    } catch (error) {
      this.log.error("secret_unseal_failed", { machineId: id, error });
      return null;
    }
  }

  private async pair(request: PairRequest, ip: string): Promise<PairReply | null> {
    const { password, policy } = this.store.settings.value;
    if (password === null || !this.codes.consume(request.code, this.now())) {
      this.log.warn("pairing_refused", { ip });
      return null;
    }
    const id = MachineId.parse(randomUUID());
    const secret = randomHex(32);
    const machine: MachineRecord = {
      id,
      name: request.hostname,
      hostname: request.hostname,
      sealedSecret: this.box.seal(secret),
      pairedAt: this.now(),
      lastSeen: null,
      lastPasswordVersion: password.version,
      lastPolicyVersion: policy.version,
    };
    await this.store.machines.update((file) => ({ ...file, machines: [...file.machines, machine] }));
    await this.record(id, "paired", `paired from ${ip}`);
    return { type: "pair_result", machineId: id, secret, password, policy };
  }

  private onReport(id: MachineId, report: StateReport): void {
    this.reports.set(id, { report, receivedAt: this.now() });
    const { password, policy } = this.store.settings.value;
    // Bring the PC up to date if it is behind (also covers PCs that were offline)
    if (password !== null && report.passwordVersion < password.version) {
      this.server?.send(id, { type: "password_update", record: password });
    }
    if (report.policyVersion < policy.version) this.server?.send(id, { type: "policy", policy });
    void this.store.machines
      .update((file) => ({
        ...file,
        machines: file.machines.map((m) =>
          m.id === id
            ? { ...m, lastSeen: this.now(), lastPasswordVersion: report.passwordVersion, lastPolicyVersion: report.policyVersion }
            : m,
        ),
      }))
      .then(() => this.changed())
      .catch((error: unknown) => this.log.error("machine_update_failed", { error }));
  }

  private onAgentEvent(id: MachineId, event: AgentEvent): void {
    void this.record(id, event.kind, event.detail);
  }

  private onOffline(id: MachineId): void {
    void this.record(id, "offline", "connection lost");
  }

  // ---------- Helpers ----------

  private broadcast(message: ServerToAgent): void {
    for (const machine of this.store.machines.value.machines) this.server?.send(machine.id, message);
  }

  private findMachine(id: MachineId): MachineRecord | undefined {
    return this.store.machines.value.machines.find((m) => m.id === id);
  }

  private async record(machineId: MachineId | null, kind: string, detail: string): Promise<void> {
    try {
      await appendEvent(this.store, { at: this.now(), machineId, kind: kind.slice(0, 40), detail: detail.slice(0, 500) });
    } catch (error) {
      this.log.error("event_log_failed", { error });
    }
    this.changed();
  }

  private changed(): void {
    this.emit("changed");
  }
}

function describeCommand(command: MachineCommand): string {
  switch (command.type) {
    case "unlock":
      return `unlock for ${Math.round(command.durationSec / 60)} min`;
    case "extend":
      return `extend by ${Math.round(command.durationSec / 60)} min`;
    case "power":
      return command.action;
    default:
      return command.type;
  }
}

// This PC's LAN addresses (IPv4, not loopback): candidates for the pairing string
export function localIPv4Addresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((infos) => infos ?? [])
    .filter((info) => info.family === "IPv4" && !info.internal)
    .map((info) => info.address);
}
