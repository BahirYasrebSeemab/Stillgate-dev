// END-TO-END: the real agent link (from @asd/agent-service) against the real manager server,
// over TLS on 127.0.0.1. Runs on Node's test runner: bun run test:node
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { decodePairing, type MachineId } from "@asd/shared";
import { silentLogger } from "@asd/shared/node";
import { ServerLink, pairWithServer, type ServerCommand, type StateReport } from "@asd/agent-service/server-link";
import type { SecretBox } from "./secret-box";
import { ManagerService } from "./service";
import { openManagerStore } from "./store";

// Stand-in for Electron's safeStorage (reversible, clearly marked)
const fakeBox: SecretBox = { seal: (plain) => `sealed:${plain}`, open: (sealed) => sealed.replace(/^sealed:/, "") };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (check: () => boolean): Promise<boolean> => {
  for (let i = 0; i < 300 && !check(); i++) await sleep(10);
  return check();
};

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === "object" && address !== null ? address.port : 0));
    });
  });
}

describe("manager <-> agent, end to end", () => {
  let dir = "";
  let service: ManagerService;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "asd-e2e-"));
    const store = await openManagerStore(dir, silentLogger);
    const port = await freePort();
    await store.settings.update((settings) => ({ ...settings, serverPort: port }));
    service = new ManagerService(store, fakeBox, silentLogger, Date.now, () => ["127.0.0.1"]);
    await service.start("127.0.0.1");
  });
  after(async () => {
    await service.stop();
    await rm(dir, { recursive: true, force: true });
  });

  let machineId: MachineId;
  let secret = "";
  let pairingInfo: ReturnType<typeof decodePairing>;

  it("refuses to create a pairing string before a restore password exists", () => {
    assert.equal(service.createPairing("127.0.0.1").ok, false);
  });

  it("pairs a PC with a one-time code", async () => {
    assert.equal((await service.setPassword("long restore pw", "long restore pw")).ok, true);
    const offer = service.createPairing("127.0.0.1");
    assert.ok(offer.ok);
    pairingInfo = decodePairing(offer.value.pairingString);
    assert.ok(pairingInfo.ok);

    const result = await pairWithServer(pairingInfo.value, "visitor-pc-1", silentLogger);
    assert.ok(result.ok, result.ok ? "" : result.error);
    machineId = result.value.machineId;
    secret = result.value.secret;
    assert.equal(result.value.password.version, 1);
    assert.equal(service.snapshot().machines[0]?.name, "visitor-pc-1");
  });

  it("does not accept the same code twice", async () => {
    assert.ok(pairingInfo.ok);
    const again = await pairWithServer(pairingInfo.value, "intruder", silentLogger);
    assert.equal(again.ok, false);
    assert.equal(service.snapshot().machines.length, 1);
  });

  it("connects, shows online, and delivers commands and policy", async () => {
    assert.ok(pairingInfo.ok);
    const { ip, port, fingerprint } = pairingInfo.value;
    const commands: ServerCommand[] = [];
    let report: StateReport = {
      type: "state_report",
      state: "LOCKED",
      remainingSec: null,
      enforcement: "audit",
      dryRun: true,
      passwordVersion: 1,
      policyVersion: 0,
      agentVersion: "0.1.0",
    };
    const link = new ServerLink({
      log: silentLogger,
      pairing: () => ({ server: { host: ip, port, fingerprint }, machineId, secret }),
      buildReport: () => report,
      onCommand: async (command) => {
        commands.push(command);
      },
      onOnlineChange: () => undefined,
    });
    link.start();
    try {
      assert.equal(await waitFor(() => service.snapshot().machines[0]?.online === true), true);
      assert.equal(await waitFor(() => service.snapshot().machines[0]?.state === "LOCKED"), true);

      const outcome = service.sendCommand([machineId], { type: "unlock", durationSec: 3600 });
      assert.deepEqual(outcome, [{ id: machineId, delivered: true }]);
      assert.equal(await waitFor(() => commands.some((c) => c.type === "unlock")), true);

      const saved = await service.savePolicy({
        apps: [],
        sites: [{ id: "khan", name: "Khan Academy", pattern: "khanacademy.org" }],
      });
      assert.ok(saved.ok);
      assert.equal(await waitFor(() => commands.some((c) => c.type === "policy")), true);

      // The agent reports it applied the new versions -> "synced"
      report = { ...report, state: "UNLOCKED", remainingSec: 3600, policyVersion: saved.value.version };
      link.sendStateReport();
      assert.equal(await waitFor(() => service.snapshot().machines[0]?.policySynced === true), true);
      assert.equal(service.snapshot().machines[0]?.state, "UNLOCKED");
    } finally {
      link.stop();
    }
  });

  it("rejects a wrong secret and an invalid policy", async () => {
    assert.ok(pairingInfo.ok);
    const { ip, port, fingerprint } = pairingInfo.value;
    const impostor = new ServerLink({
      log: silentLogger,
      pairing: () => ({ server: { host: ip, port, fingerprint }, machineId, secret: "0".repeat(64) }),
      buildReport: () => {
        throw new Error("must never get this far");
      },
      onCommand: async () => undefined,
      onOnlineChange: () => undefined,
    });
    impostor.start();
    await sleep(400);
    assert.equal(impostor.isOnline(), false);
    impostor.stop();

    const bad = await service.savePolicy({ apps: [], sites: [{ id: "all", name: "Everything", pattern: "*" }] });
    assert.equal(bad.ok, false);
  });

  it("revoking a PC removes it", async () => {
    assert.equal((await service.revokeMachine(machineId)).ok, true);
    assert.equal(service.snapshot().machines.length, 0);
  });
});
