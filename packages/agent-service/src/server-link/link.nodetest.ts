// Runs under NODE's built-in test runner (not Bun), because TLS behaves differently in Bun
// and the agent runs on Node in production. Run with: bun run test:node
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { MachineId } from "@asd/shared";
import { randomHex, silentLogger } from "@asd/shared/node";
import { MACHINE_ID } from "../test-helpers/fakes";
import { startTestServer, type TestServer } from "../test-helpers/test-server";
import { reconnectDelayMs } from "./backoff";
import { ServerLink, type ServerCommand, type StateReport } from "./client";
import { pairWithServer } from "./pair";

const machineId = MachineId.parse(MACHINE_ID);
const secret = randomHex(32);

const report: StateReport = {
  type: "state_report",
  state: "LOCKED",
  remainingSec: null,
  enforcement: "audit",
  dryRun: true,
  passwordVersion: 1,
  policyVersion: 1,
  agentVersion: "0.1.0",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (check: () => boolean): Promise<boolean> => {
  for (let i = 0; i < 200 && !check(); i++) await sleep(10);
  return check();
};

function makeLink(server: TestServer, fingerprint: string, linkSecret = secret) {
  const commands: ServerCommand[] = [];
  const link = new ServerLink({
    log: silentLogger,
    pairing: () => ({ server: { host: "127.0.0.1", port: server.port, fingerprint }, machineId, secret: linkSecret }),
    buildReport: () => report,
    onCommand: async (command) => {
      commands.push(command);
    },
    onOnlineChange: () => undefined,
  });
  return { link, commands };
}

describe("ServerLink (Node)", async () => {
  const server = await startTestServer(machineId, secret);
  after(() => server.close());

  it("authenticates, reports state and receives commands", async () => {
    const { link, commands } = makeLink(server, server.fingerprint);
    link.start();
    assert.equal(await waitFor(() => link.isOnline()), true);
    assert.equal(await waitFor(() => server.received.includes("state_report")), true);
    server.send({ type: "unlock", durationSec: 3600 });
    assert.equal(await waitFor(() => commands.length === 1), true);
    assert.deepEqual(commands[0], { type: "unlock", durationSec: 3600 });
    link.stop();
  });

  it("refuses a server whose certificate fingerprint does not match, sending nothing", async () => {
    const before = server.received.length;
    const { link } = makeLink(server, "f".repeat(64));
    link.start();
    await sleep(400);
    assert.equal(link.isOnline(), false);
    assert.equal(server.received.length, before);
    link.stop();
  });

  it("does not go online with the wrong secret", async () => {
    const { link } = makeLink(server, server.fingerprint, randomHex(32));
    link.start();
    await sleep(400);
    assert.equal(link.isOnline(), false);
    link.stop();
  });

  it("pairs with the right fingerprint and refuses the wrong one", async () => {
    const info = { ip: "127.0.0.1", port: server.port, fingerprint: server.fingerprint, code: "ABCD2345" };
    const good = await pairWithServer(info, "pc-1", silentLogger);
    assert.equal(good.ok && good.value.machineId, machineId);
    const bad = await pairWithServer({ ...info, fingerprint: "0".repeat(64) }, "pc-1", silentLogger);
    assert.equal(bad.ok, false);
  });
});

describe("reconnectDelayMs", () => {
  it("doubles up to the cap and applies jitter", () => {
    assert.deepEqual([0, 1, 2, 3].map((n) => reconnectDelayMs(n, 0.5)), [1000, 2000, 4000, 8000]);
    assert.equal(reconnectDelayMs(20, 0.5), 60_000);
    assert.equal(reconnectDelayMs(0, 0), 800);
    assert.equal(reconnectDelayMs(0, 1), 1200);
  });
});
