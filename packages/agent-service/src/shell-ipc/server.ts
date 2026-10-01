import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import {
  LineSplitter,
  MAX_SHELL_REQUEST_BYTES,
  parseShellRequest,
  type AgentToShell,
  type AppId,
  type Result,
  type ShellErrorCode,
  type ShellRequest,
  type ShellResult,
  type ShellState,
  type SiteId,
} from "@asd/shared";
import { safeEqualHex, type Logger } from "@asd/shared/node";
import type { RestoreError } from "../password/restore";

// Loopback server for the kiosk shell: one JSON object per line on 127.0.0.1 only.
// Security rules:
//   - every request carries the token from the token file (only the kiosk user can read it)
//   - anything that looks like HTTP (a web page trying to reach us) is dropped at once
//   - invalid JSON, a wrong token or an oversized line -> the connection is closed
//   - the shell sends ids only; paths and URLs come from the agent's own policy

export type ShellIpcDeps = {
  readonly log: Logger;
  readonly port: number;
  readonly token: string;
  readonly getState: () => ShellState;
  readonly launchApp: (id: AppId) => Result<{ exePath: string; args: string[] }, ShellErrorCode>;
  readonly openSite: (id: SiteId) => Result<{ url: string }, ShellErrorCode>;
  readonly restore: (password: string) => Promise<Result<true, RestoreError>>;
};

const HTTP_LIKE = /^(GET|POST|PUT|HEAD|OPTIONS|DELETE|PATCH|CONNECT|TRACE) |^origin:|^host:/i;
const MAX_CONNECTIONS = 8;
const FIRST_REQUEST_TIMEOUT_MS = 5000;

export class ShellIpcServer {
  private server: Server | null = null;
  private readonly subscribers = new Set<Socket>();

  constructor(private readonly deps: ShellIpcDeps) {}

  start(): Promise<number> {
    const server = createServer((socket) => this.onConnection(socket));
    server.maxConnections = MAX_CONNECTIONS;
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.deps.port, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
    });
  }

  stop(): Promise<void> {
    for (const socket of this.subscribers) socket.destroy();
    return new Promise((resolve) => (this.server === null ? resolve() : this.server.close(() => resolve())));
  }

  pushState(): void {
    if (this.subscribers.size === 0) return;
    const message = line({ type: "push", state: this.deps.getState() });
    for (const socket of this.subscribers) socket.write(message);
  }

  private onConnection(socket: Socket): void {
    socket.setEncoding("utf8");
    const splitter = new LineSplitter(MAX_SHELL_REQUEST_BYTES);
    let trusted = false;
    const firstRequestTimer = setTimeout(() => socket.destroy(), FIRST_REQUEST_TIMEOUT_MS);

    socket.on("data", (chunk: string) => {
      const { lines, overflow } = splitter.push(chunk);
      if (overflow) return this.drop(socket, "line_too_long");
      for (const text of lines) {
        if (HTTP_LIKE.test(text)) return this.drop(socket, "http_request");
        const parsed = parseShellRequest(text);
        if (!parsed.ok) return this.drop(socket, "bad_request", parsed.error);
        if (!safeEqualHex(parsed.value.token, this.deps.token)) {
          socket.write(line({ type: "error", reqId: parsed.value.reqId, error: "unauthorized" }));
          return this.drop(socket, "bad_token");
        }
        if (!trusted) {
          trusted = true;
          clearTimeout(firstRequestTimer);
        }
        void this.handle(socket, parsed.value);
      }
    });
    socket.on("error", () => undefined);
    socket.on("close", () => {
      clearTimeout(firstRequestTimer);
      this.subscribers.delete(socket);
    });
  }

  private async handle(socket: Socket, request: ShellRequest): Promise<void> {
    const reply = (result: ShellResult) => socket.write(line({ type: "reply", reqId: request.reqId, result }));
    const fail = (error: ShellErrorCode, retryAfterSec?: number) =>
      socket.write(
        line({ type: "error", reqId: request.reqId, error, ...(retryAfterSec === undefined ? {} : { retryAfterSec }) }),
      );

    switch (request.cmd) {
      case "getState":
        return void reply({ kind: "state", state: this.deps.getState() });
      case "subscribe":
        this.subscribers.add(socket);
        return void reply({ kind: "state", state: this.deps.getState() });
      case "launchApp": {
        const result = this.deps.launchApp(request.appId);
        return void (result.ok ? reply({ kind: "launch", ...result.value }) : fail(result.error));
      }
      case "openSite": {
        const result = this.deps.openSite(request.siteId);
        return void (result.ok ? reply({ kind: "open", ...result.value }) : fail(result.error));
      }
      case "restore": {
        const result = await this.deps.restore(request.password);
        return void (result.ok ? reply({ kind: "restoring" }) : fail(result.error.code, result.error.retryAfterSec));
      }
    }
  }

  private drop(socket: Socket, reason: string, detail?: string): void {
    this.deps.log.warn("shell_ipc_dropped", { reason, ...(detail === undefined ? {} : { detail }) });
    socket.destroy();
  }
}

function line(message: AgentToShell): string {
  return `${JSON.stringify(message)}\n`;
}
