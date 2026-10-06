import {
  APP_VERSION,
  AUTH_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  OFFLINE_AFTER_MS,
  PROTOCOL_VERSION,
  parseServerMessage,
  type AgentToServer,
  type ServerToAgent,
} from "@stillgate/shared";
import { authMac, type Logger } from "@stillgate/shared/node";
import type WebSocket from "ws";
import type { Pairing } from "../config";
import { reconnectDelayMs } from "./backoff";
import { openPinnedSocket, textOf } from "./pinned-socket";

// The agent's connection to the manager. It always connects OUT (visitor PCs open no ports),
// proves who it is with challenge-response, then waits for commands.
// While disconnected NOTHING changes on the PC: it keeps its state and never unlocks itself.

export type ServerCommand = Exclude<
  ServerToAgent,
  { type: "auth_challenge" | "auth_ok" | "pair_result" | "error" }
>;
export type StateReport = Extract<AgentToServer, { type: "state_report" }>;

export type LinkDeps = {
  readonly log: Logger;
  readonly pairing: () => Pairing | null;
  readonly buildReport: () => StateReport;
  readonly onCommand: (command: ServerCommand) => Promise<void>;
  readonly onOnlineChange: (online: boolean) => void;
};

type Phase = "connecting" | "awaiting_challenge" | "awaiting_ok" | "online";

const NOT_PAIRED_RETRY_MS = 10_000;
const AUTH_FAILED_RETRY_MS = 60_000;

export class ServerLink {
  private socket: WebSocket | null = null;
  private phase: Phase = "connecting";
  private attempt = 0;
  private stopped = true;
  private timers = new Set<NodeJS.Timeout>();
  private liveness: NodeJS.Timeout | null = null;
  private nextRetryMs: number | null = null;

  constructor(private readonly deps: LinkDeps) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.socket?.terminate();
  }

  isOnline(): boolean {
    return this.phase === "online";
  }

  sendStateReport(): void {
    if (this.isOnline()) this.send(this.deps.buildReport());
  }

  sendEvent(kind: string, detail: string): void {
    if (this.isOnline()) this.send({ type: "event", kind, detail: detail.slice(0, 500), at: Date.now() });
  }

  private connect(): void {
    if (this.stopped) return;
    const pairing = this.deps.pairing();
    if (pairing === null) return this.retryIn(NOT_PAIRED_RETRY_MS);

    const { host, port, fingerprint } = pairing.server;
    const socket = openPinnedSocket(host, port, fingerprint, this.deps.log);
    this.socket = socket;
    this.phase = "connecting";

    socket.on("open", () => {
      this.phase = "awaiting_challenge";
      this.send({ type: "hello", protocol: PROTOCOL_VERSION, machineId: pairing.machineId, agentVersion: APP_VERSION });
      this.after(AUTH_TIMEOUT_MS, () => {
        if (this.socket === socket && this.phase !== "online") socket.terminate();
      });
    });
    socket.on("message", (data) => this.onMessage(textOf(data), pairing).catch((error: unknown) => {
      this.deps.log.error("server_message_failed", { error });
    }));
    socket.on("ping", () => this.touch(socket));
    socket.on("error", (error) => this.deps.log.warn("server_socket_error", { error: error.message }));
    socket.on("close", () => this.onClose(socket));
  }

  private async onMessage(text: string, pairing: Pairing): Promise<void> {
    const socket = this.socket;
    if (socket === null) return;
    this.touch(socket);
    const parsed = parseServerMessage(text);
    if (!parsed.ok) {
      this.deps.log.warn("server_bad_message", { detail: parsed.error });
      if (!this.isOnline()) socket.terminate();
      return;
    }
    const message = parsed.value;

    if (message.type === "error") {
      this.deps.log.error("server_error", { code: message.code, message: message.message });
      if (message.code === "auth_failed") this.nextRetryMs = AUTH_FAILED_RETRY_MS;
      socket.terminate();
      return;
    }
    if (this.phase === "awaiting_challenge" && message.type === "auth_challenge") {
      this.phase = "awaiting_ok";
      this.send({ type: "auth_response", mac: authMac(pairing.secret, message.nonce, pairing.machineId) });
      return;
    }
    if (this.phase === "awaiting_ok" && message.type === "auth_ok") return this.goOnline(socket);
    if (this.phase !== "online") {
      this.deps.log.warn("server_unexpected_message", { phase: this.phase, type: message.type });
      socket.terminate();
      return;
    }
    if (message.type === "auth_challenge" || message.type === "auth_ok" || message.type === "pair_result") return;
    await this.deps.onCommand(message);
  }

  private goOnline(socket: WebSocket): void {
    this.phase = "online";
    this.attempt = 0;
    this.deps.log.info("server_online");
    this.deps.onOnlineChange(true);
    this.sendStateReport();
    const heartbeat = setInterval(() => this.send({ type: "heartbeat" }), HEARTBEAT_INTERVAL_MS);
    socket.once("close", () => clearInterval(heartbeat));
  }

  // If the server goes silent (no message, no ping) for too long, drop the connection
  private touch(socket: WebSocket): void {
    if (this.liveness !== null) clearTimeout(this.liveness);
    this.liveness = setTimeout(() => {
      this.deps.log.warn("server_silent");
      socket.terminate();
    }, OFFLINE_AFTER_MS);
  }

  private onClose(socket: WebSocket): void {
    if (this.socket !== socket) return;
    const wasOnline = this.isOnline();
    this.socket = null;
    this.phase = "connecting";
    if (this.liveness !== null) clearTimeout(this.liveness);
    if (wasOnline) {
      this.deps.log.warn("server_offline");
      this.deps.onOnlineChange(false);
    }
    const delay = this.nextRetryMs ?? reconnectDelayMs(this.attempt);
    this.nextRetryMs = null;
    this.attempt += 1;
    this.retryIn(delay);
  }

  private retryIn(ms: number): void {
    this.after(ms, () => this.connect());
  }

  private after(ms: number, run: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      run();
    }, ms);
    this.timers.add(timer);
  }

  private send(message: AgentToServer): void {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(message));
  }
}
