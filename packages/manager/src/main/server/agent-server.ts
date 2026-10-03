import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import {
  AUTH_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  parseAgentMessage,
  type AgentToServer,
  type MachineId,
  type ServerToAgent,
} from "@asd/shared";
import { authMac, randomHex, safeEqualHex, type Logger } from "@asd/shared/node";
import { WebSocketServer, type WebSocket } from "ws";
import type { AuthLimiter } from "./guards";

// The ONLY network listener of the whole system: agents connect here over TLS (wss://).
// Every connection must prove it knows its machine secret (challenge-response) or pair
// with a one-time code. Anything else is dropped. The manager UI is NOT reachable here.

export type StateReport = Extract<AgentToServer, { type: "state_report" }>;
export type AgentEvent = Extract<AgentToServer, { type: "event" }>;
export type PairRequest = Extract<AgentToServer, { type: "pair_request" }>;
export type PairReply = Extract<ServerToAgent, { type: "pair_result" }>;

export type AgentServerDeps = {
  readonly log: Logger;
  readonly key: string;
  readonly cert: string;
  readonly port: number;
  readonly host?: string;
  readonly limiter: AuthLimiter;
  readonly now: () => number;
  // Returns the (unsealed) secret of a paired machine, or null if unknown
  readonly secretOf: (id: MachineId) => string | null;
  readonly onPair: (request: PairRequest, ip: string) => Promise<PairReply | null>;
  readonly onOnline: (id: MachineId, ip: string) => void;
  readonly onReport: (id: MachineId, report: StateReport) => void;
  readonly onEvent: (id: MachineId, event: AgentEvent) => void;
  readonly onOffline: (id: MachineId) => void;
};

// At most this many connections may be open WITHOUT having logged in yet (each has 10 s to do so).
// Stops a flood of half-open connections from using up the manager PC.
const MAX_PENDING_CONNECTIONS = 32;

type Session = {
  readonly socket: WebSocket;
  readonly ip: string;
  phase: "new" | "challenged" | "online" | "closing";
  machineId: MachineId | null;
  nonce: string | null;
  alive: boolean;
};

export class AgentServer {
  private https: Server | null = null;
  private wss: WebSocketServer | null = null;
  private pinger: NodeJS.Timeout | null = null;
  private readonly online = new Map<MachineId, Session>();
  private pendingCount = 0;

  constructor(private readonly deps: AgentServerDeps) {}

  start(): Promise<number> {
    const https = createServer({ key: this.deps.key, cert: this.deps.cert });
    const wss = new WebSocketServer({ server: https, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false });
    wss.on("connection", (socket, request) => this.accept(socket, request.socket.remoteAddress ?? "unknown"));
    this.https = https;
    this.wss = wss;
    this.pinger = setInterval(() => this.pingAll(), HEARTBEAT_INTERVAL_MS);
    return new Promise((resolve, reject) => {
      https.once("error", reject);
      https.listen(this.deps.port, this.deps.host ?? "0.0.0.0", () => resolve((https.address() as AddressInfo).port));
    });
  }

  stop(): Promise<void> {
    if (this.pinger !== null) clearInterval(this.pinger);
    for (const session of this.online.values()) session.socket.terminate();
    this.wss?.close();
    return new Promise((resolve) => (this.https === null ? resolve() : this.https.close(() => resolve())));
  }

  isOnline(id: MachineId): boolean {
    return this.online.has(id);
  }

  send(id: MachineId, message: ServerToAgent): boolean {
    const session = this.online.get(id);
    if (session === undefined || session.socket.readyState !== 1) return false;
    session.socket.send(JSON.stringify(message));
    return true;
  }

  disconnect(id: MachineId): void {
    this.online.get(id)?.socket.terminate();
  }

  private accept(socket: WebSocket, rawIp: string): void {
    const ip = rawIp.replace(/^::ffff:/, "");
    if (this.deps.limiter.isBlocked(ip, this.deps.now())) {
      socket.terminate();
      return;
    }
    if (this.pendingCount >= MAX_PENDING_CONNECTIONS) {
      this.deps.log.warn("agent_too_many_pending", { ip });
      socket.terminate();
      return;
    }
    this.pendingCount += 1;
    let counted = true;
    const leavePending = () => {
      if (counted) this.pendingCount -= 1;
      counted = false;
    };
    const session: Session = { socket, ip, phase: "new", machineId: null, nonce: null, alive: true };
    const authTimer = setTimeout(() => {
      if (session.phase !== "online") socket.terminate();
    }, AUTH_TIMEOUT_MS);

    socket.on("message", (data) => {
      session.alive = true;
      if (session.phase === "online") leavePending();
      this.onMessage(session, data.toString()).catch((error: unknown) => {
        this.deps.log.error("agent_message_failed", { ip, error });
        socket.terminate();
      });
    });
    socket.on("pong", () => (session.alive = true));
    socket.on("error", () => undefined);
    socket.on("close", () => {
      clearTimeout(authTimer);
      leavePending();
      const id = session.machineId;
      if (session.phase === "online" && id !== null && this.online.get(id) === session) {
        this.online.delete(id);
        this.deps.onOffline(id);
      }
    });
  }

  private async onMessage(session: Session, text: string): Promise<void> {
    const parsed = parseAgentMessage(text);
    if (!parsed.ok) {
      this.deps.log.warn("agent_bad_message", { ip: session.ip, detail: parsed.error });
      if (session.phase !== "online") this.reject(session, "bad_message", "invalid message");
      return;
    }
    const message = parsed.value;

    if (session.phase === "online") return this.onOnlineMessage(session, message);
    switch (message.type) {
      case "hello":
        return this.onHello(session, message);
      case "auth_response":
        return this.onAuthResponse(session, message.mac);
      case "pair_request":
        return this.onPairRequest(session, message);
      default:
        return this.reject(session, "bad_message", "authenticate first");
    }
  }

  private onHello(session: Session, hello: Extract<AgentToServer, { type: "hello" }>): void {
    if (session.phase !== "new") return this.reject(session, "bad_message", "unexpected hello");
    if (hello.protocol !== PROTOCOL_VERSION) return this.reject(session, "protocol_mismatch", "update the agent");
    // Unknown machines also get a challenge, so a scanner can't tell which ids exist
    session.machineId = hello.machineId;
    session.nonce = randomHex(32);
    session.phase = "challenged";
    this.write(session, { type: "auth_challenge", nonce: session.nonce });
  }

  private onAuthResponse(session: Session, mac: string): void {
    const id = session.machineId;
    if (session.phase !== "challenged" || id === null || session.nonce === null) {
      return this.reject(session, "bad_message", "unexpected auth_response");
    }
    const secret = this.deps.secretOf(id);
    if (secret === null || !safeEqualHex(mac, authMac(secret, session.nonce, id))) {
      this.deps.limiter.recordFailure(session.ip, this.deps.now());
      this.deps.log.warn("agent_auth_failed", { ip: session.ip, machineId: id });
      return this.reject(session, "auth_failed", "authentication failed");
    }
    this.online.get(id)?.socket.terminate(); // a newer connection replaces an old one
    session.phase = "online";
    session.nonce = null;
    this.online.set(id, session);
    this.write(session, { type: "auth_ok" });
    this.deps.onOnline(id, session.ip);
  }

  private async onPairRequest(session: Session, request: PairRequest): Promise<void> {
    if (session.phase !== "new") return this.reject(session, "bad_message", "unexpected pair_request");
    session.phase = "closing";
    const reply = request.protocol === PROTOCOL_VERSION ? await this.deps.onPair(request, session.ip) : null;
    if (reply === null) {
      this.deps.limiter.recordFailure(session.ip, this.deps.now());
      return this.reject(session, "pairing_failed", "pairing code invalid or expired");
    }
    this.write(session, reply);
    session.socket.close();
  }

  private onOnlineMessage(session: Session, message: AgentToServer): void {
    const id = session.machineId;
    if (id === null) return;
    switch (message.type) {
      case "state_report":
        return this.deps.onReport(id, message);
      case "event":
        return this.deps.onEvent(id, message);
      case "heartbeat":
        return;
      default:
        this.deps.log.warn("agent_unexpected_message", { machineId: id, type: message.type });
    }
  }

  private reject(session: Session, code: Extract<ServerToAgent, { type: "error" }>["code"], text: string): void {
    session.phase = "closing";
    this.write(session, { type: "error", code, message: text });
    session.socket.close();
  }

  private write(session: Session, message: ServerToAgent): void {
    if (session.socket.readyState === 1) session.socket.send(JSON.stringify(message));
  }

  // Standard ws keep-alive: ping everyone; whoever did not answer since the last round is dropped
  private pingAll(): void {
    for (const session of this.online.values()) {
      if (!session.alive) {
        session.socket.terminate();
        continue;
      }
      session.alive = false;
      session.socket.ping();
    }
  }
}
