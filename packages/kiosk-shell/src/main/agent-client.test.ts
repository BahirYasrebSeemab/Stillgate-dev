// Integration test: the kiosk's real AgentClient against the agent's real ShellIpcServer,
// over a loopback socket, with a real token file.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ShellIpcServer } from "@asd/agent-service/shell-ipc";
import { err, ok, type ShellState } from "@asd/shared";
import { randomHex, silentLogger, writeJsonAtomic } from "@asd/shared/node";
import { AgentClient } from "./agent-client";

const TOKEN = randomHex(32);
let state: ShellState = { lock: "LOCKED", remainingSec: null, serverOnline: true, apps: [], sites: [] };
const launched: string[] = [];

const server = new ShellIpcServer({
  log: silentLogger,
  port: 0,
  token: TOKEN,
  getState: () => state,
  launchApp: (id) => {
    if (state.lock !== "UNLOCKED") return err("not_allowed");
    launched.push(id);
    return ok({ exePath: "C:\\Apps\\paint.exe", args: [] });
  },
  openSite: () => err("not_allowed"),
  restore: async () => err({ code: "locked_out", retryAfterSec: 42 }),
});

let dir = "";
let client: AgentClient;
const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  return check();
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "asd-kiosk-"));
  const port = await server.start();
  const tokenFile = join(dir, "shell-token");
  await writeJsonAtomic(tokenFile, { schemaVersion: 1, token: TOKEN, port });
  client = new AgentClient(tokenFile, silentLogger);
  client.start();
});

afterAll(async () => {
  client.stop();
  await server.stop();
  await rm(dir, { recursive: true, force: true });
});

describe("AgentClient <-> ShellIpcServer", () => {
  it("subscribes and receives the current state", async () => {
    expect(await waitFor(() => client.state?.lock === "LOCKED")).toBe(true);
  });

  it("gets state pushes when the agent's state changes", async () => {
    state = { ...state, lock: "UNLOCKED", remainingSec: 600 };
    server.pushState();
    expect(await waitFor(() => client.state?.lock === "UNLOCKED")).toBe(true);
  });

  it("asks the agent before launching, and gets the path from the agent", async () => {
    const reply = await client.request({ cmd: "launchApp", appId: "paint" as never });
    expect(reply).toEqual({ type: "reply", reqId: expect.any(Number), result: { kind: "launch", exePath: "C:\\Apps\\paint.exe", args: [] } });
    expect(launched).toEqual(["paint"]);
  });

  it("passes the restore lockout through", async () => {
    const reply = await client.request({ cmd: "restore", password: "guess" });
    expect(reply).toEqual({ type: "error", reqId: expect.any(Number), error: "locked_out", retryAfterSec: 42 });
  });
});

describe("AgentClient without an agent", () => {
  it("reports null state (the UI then stays locked)", async () => {
    const lonely = new AgentClient(join(tmpdir(), "does-not-exist", "shell-token"), silentLogger);
    expect(await lonely.request({ cmd: "getState" })).toBeNull();
    expect(lonely.state).toBeNull();
  });
});
