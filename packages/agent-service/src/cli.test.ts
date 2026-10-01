import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { AgentPaths } from "./paths";
import { silentLogger } from "@asd/shared/node";
import { runCli } from "./cli";
import { ConfigStore } from "./config";
import { pendingControlRequests, processControlRequests, type ControlRequest } from "./control";
import { KIOSK, tempPaths } from "./test-helpers/fakes";

let paths: AgentPaths;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ paths, cleanup } = await tempPaths());
});
afterAll(() => cleanup());

describe("agent CLI", () => {
  it("starts with the safe defaults", async () => {
    const config = (await ConfigStore.load(paths.configFile, silentLogger)).value;
    expect(config.dryRun).toBe(true);
    expect(config.enforcement).toBe("audit");
  });

  it("init stores the kiosk user and asks the service to reload", async () => {
    const exit = await runCli(
      ["init", "--kiosk-user", KIOSK.user, "--kiosk-sid", KIOSK.sid, "--shell-exe", KIOSK.shellExe],
      paths,
      silentLogger,
    );
    expect(exit.code).toBe(0);
    expect((await ConfigStore.load(paths.configFile, silentLogger)).value.kiosk).toEqual(KIOSK);
    expect(await pendingControlRequests(paths.controlDir)).toHaveLength(1);
  });

  it("rejects a bad SID and unknown commands", async () => {
    expect((await runCli(["init", "--kiosk-user", "k", "--kiosk-sid", "x", "--shell-exe", "y"], paths, silentLogger)).code).toBe(2);
    expect((await runCli(["format-disk"], paths, silentLogger)).code).toBe(2);
    expect((await runCli(["set-enforcement", "kill-all"], paths, silentLogger)).code).toBe(2);
  });

  it("queues control requests that the service then processes in order", async () => {
    await runCli(["set-enforcement", "enforce"], paths, silentLogger);
    await runCli(["rearm"], paths, silentLogger);
    const handled: ControlRequest[] = [];
    await processControlRequests(paths.controlDir, silentLogger, async (request) => {
      handled.push(request);
    });
    expect(handled.map((request) => request.cmd)).toEqual(["reload", "set-enforcement", "rearm"]);
    expect(await pendingControlRequests(paths.controlDir)).toHaveLength(0);
  });

  it("prints a status summary", async () => {
    const exit = await runCli(["status"], paths, silentLogger);
    expect(exit.text).toContain("dry-run:       ON");
    expect(exit.text).toContain("kiosk user:    kiosk");
  });
});
