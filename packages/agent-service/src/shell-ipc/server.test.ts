import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { connect, type Socket } from "node:net";
import { LineSplitter, err, ok, parseAgentToShell, type AgentToShell, type ShellState } from "@stillgate/shared";
import { randomHex, silentLogger } from "@stillgate/shared/node";
import { ShellIpcServer } from "./server";

const TOKEN = randomHex(32);
const state: ShellState = { lock: "LOCKED", remainingSec: null, serverOnline: false, apps: [], sites: [] };

const server = new ShellIpcServer({
  log: silentLogger,
  port: 0, // 0 = let the OS pick a free port
  token: TOKEN,
  getState: () => state,
  launchApp: (id) => (id === "paint" ? ok({ exePath: "C:\\paint.exe", args: [] }) : err("not_allowed")),
  openSite: () => err("not_allowed"),
  restore: async (password) => (password === "right" ? ok(true) : err({ code: "wrong_password" })),
});
let port = 0;
beforeAll(async () => {
  port = await server.start();
});
afterAll(() => server.stop());

// Opens a client and collects parsed replies; `closed` resolves when the agent hangs up
function client() {
  const socket: Socket = connect(port, "127.0.0.1");
  const splitter = new LineSplitter(1_000_000);
  const messages: AgentToShell[] = [];
  const closed = new Promise<void>((resolve) => socket.on("close", () => resolve()));
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    for (const line of splitter.push(chunk).lines) {
      const parsed = parseAgentToShell(line);
      if (parsed.ok) messages.push(parsed.value);
    }
  });
  const send = (value: unknown) => socket.write(`${typeof value === "string" ? value : JSON.stringify(value)}\n`);
  const next = async (count: number) => {
    for (let i = 0; i < 100 && messages.length < count; i++) await new Promise((r) => setTimeout(r, 10));
    return messages[count - 1];
  };
  return { socket, send, next, closed };
}

describe("ShellIpcServer", () => {
  it("answers getState with the right token", async () => {
    const c = client();
    c.send({ token: TOKEN, reqId: 1, cmd: "getState" });
    expect(await c.next(1)).toEqual({ type: "reply", reqId: 1, result: { kind: "state", state } });
    c.socket.destroy();
  });

  it("returns a launch spec for an allowed app and an error otherwise", async () => {
    const c = client();
    c.send({ token: TOKEN, reqId: 2, cmd: "launchApp", appId: "paint" });
    c.send({ token: TOKEN, reqId: 3, cmd: "launchApp", appId: "notepad" });
    expect(await c.next(1)).toEqual({ type: "reply", reqId: 2, result: { kind: "launch", exePath: "C:\\paint.exe", args: [] } });
    expect(await c.next(2)).toEqual({ type: "error", reqId: 3, error: "not_allowed" });
    c.socket.destroy();
  });

  it("closes the connection on a wrong token", async () => {
    const c = client();
    c.send({ token: "b".repeat(64), reqId: 4, cmd: "getState" });
    await c.closed;
    expect(await c.next(1)).toEqual({ type: "error", reqId: 4, error: "unauthorized" });
  });

  it("drops anything that looks like a browser request", async () => {
    const c = client();
    c.send("POST / HTTP/1.1");
    await c.closed;
  });

  it("drops invalid JSON", async () => {
    const c = client();
    c.send("{nope");
    await c.closed;
  });

  it("pushes state to subscribers", async () => {
    const c = client();
    c.send({ token: TOKEN, reqId: 5, cmd: "subscribe" });
    await c.next(1);
    server.pushState();
    expect(await c.next(2)).toEqual({ type: "push", state });
    c.socket.destroy();
  });

  it("passes restore errors through", async () => {
    const c = client();
    c.send({ token: TOKEN, reqId: 6, cmd: "restore", password: "wrong" });
    expect(await c.next(1)).toEqual({ type: "error", reqId: 6, error: "wrong_password" });
    c.socket.destroy();
  });
});
