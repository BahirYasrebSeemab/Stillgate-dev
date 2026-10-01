import { EventEmitter } from "node:events";
import { connect, type Socket } from "node:net";
import {
  LineSplitter,
  MAX_SHELL_PUSH_BYTES,
  ShellTokenFile,
  parseAgentToShell,
  type AgentToShell,
  type ShellRequest,
  type ShellState,
} from "@asd/shared";
import { readJson, type Logger } from "@asd/shared/node";

// The kiosk shell's line to the agent service: 127.0.0.1 TCP, one JSON object per line.
// It reads the token file (only the kiosk user can read it), subscribes to state pushes,
// and reconnects forever. If the agent can't be reached, state is null -> the UI stays LOCKED.

type Reply = Extract<AgentToShell, { type: "reply" | "error" }>;
type ClientEvents = { state: [state: ShellState | null] };
// Distributive Omit keeps each command's own fields (plain Omit on a union would drop them)
type RequestWithout<T> = T extends unknown ? Omit<T, "token" | "reqId"> : never;
export type AgentCommand = RequestWithout<ShellRequest>;

const RETRY_MS = 2000;
const REQUEST_TIMEOUT_MS = 8000;

export class AgentClient extends EventEmitter<ClientEvents> {
  private socket: Socket | null = null;
  private token: string | null = null;
  private nextReqId = 1;
  private readonly pending = new Map<number, (reply: Reply | null) => void>();
  private current: ShellState | null = null;
  private stopped = false;

  constructor(
    private readonly tokenFile: string,
    private readonly log: Logger,
  ) {
    super();
  }

  get state(): ShellState | null {
    return this.current;
  }

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.socket?.destroy();
  }

  // Sends one command; resolves with the agent's reply, or null if it can't be reached in time
  request(command: AgentCommand): Promise<Reply | null> {
    const socket = this.socket;
    if (socket === null || this.token === null) return Promise.resolve(null);
    const reqId = this.nextReqId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.settle(reqId, null), REQUEST_TIMEOUT_MS);
      this.pending.set(reqId, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
      socket.write(`${JSON.stringify({ ...command, token: this.token, reqId })}\n`);
    });
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const file = await readJson(this.tokenFile, ShellTokenFile);
    if (!file.ok) {
      this.setState(null);
      return this.retry();
    }
    this.token = file.value.token;
    const socket = connect(file.value.port, "127.0.0.1");
    const splitter = new LineSplitter(MAX_SHELL_PUSH_BYTES);
    this.socket = socket;
    socket.setEncoding("utf8");

    socket.on("connect", () => {
      this.log.info("agent_connected", { port: file.value.port });
      void this.request({ cmd: "subscribe" }).then((reply) => {
        if (reply?.type === "reply" && reply.result.kind === "state") this.setState(reply.result.state);
      });
    });
    socket.on("data", (chunk: string) => {
      const { lines, overflow } = splitter.push(chunk);
      if (overflow) return socket.destroy();
      for (const line of lines) this.onLine(line);
    });
    socket.on("error", () => undefined);
    socket.on("close", () => {
      if (this.current !== null) this.log.warn("agent_disconnected");
      if (this.socket === socket) this.socket = null;
      for (const reqId of [...this.pending.keys()]) this.settle(reqId, null);
      this.setState(null);
      this.retry();
    });
  }

  private onLine(line: string): void {
    const parsed = parseAgentToShell(line);
    if (!parsed.ok) {
      this.log.warn("agent_bad_line", { detail: parsed.error });
      return;
    }
    const message = parsed.value;
    if (message.type === "push") this.setState(message.state);
    else this.settle(message.reqId, message);
  }

  private settle(reqId: number, reply: Reply | null): void {
    const resolve = this.pending.get(reqId);
    this.pending.delete(reqId);
    resolve?.(reply);
  }

  private setState(state: ShellState | null): void {
    this.current = state;
    this.emit("state", state);
  }

  private retry(): void {
    if (!this.stopped) setTimeout(() => void this.connect(), RETRY_MS);
  }
}
