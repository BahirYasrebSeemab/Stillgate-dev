import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { AgentPaths } from "../paths";
import { LOCKED, PersistedState, type Effect } from "@asd/shared";
import { readJson, silentLogger } from "@asd/shared/node";
import { ConfigStore } from "../config";
import { createEffectRunner } from "../effects";
import { FakeClock, FakeExec, KIOSK, tempPaths } from "../test-helpers/fakes";
import { Lockdown } from "../windows/lockdown";
import { Power } from "../windows/power";
import { Registry } from "../windows/registry";
import { StateRunner } from "./runner";

let paths: AgentPaths;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ paths, cleanup } = await tempPaths());
});
afterAll(() => cleanup());

async function setup(answerQuery: string) {
  const config = await ConfigStore.load(paths.configFile, silentLogger);
  await config.update((c) => ({ ...c, kiosk: KIOSK, dryRun: false }));
  const exec = new FakeExec(({ args }) =>
    args[0] === "query" && args[2] === "/v"
      ? { code: 0, stdout: `    Shell    REG_SZ    ${answerQuery}\r\n`, stderr: "" }
      : { code: 0, stdout: "", stderr: "" },
  );
  const registry = new Registry(exec);
  const clock = new FakeClock();
  let reports = 0;
  const runEffects = createEffectRunner({
    config,
    registry,
    power: new Power(exec, silentLogger),
    lockdown: new Lockdown(registry, silentLogger),
    clock,
    stateFile: paths.stateFile,
    log: silentLogger,
    report: () => reports++,
  });
  const runner = new StateRunner(LOCKED, clock, runEffects, silentLogger);
  return { runner, exec, clock, reports: () => reports };
}

const restarts = (exec: FakeExec) => exec.calls.filter((call) => call.tool === "shutdown");

describe("StateRunner + effects", () => {
  it("unlocks, persists, reports, and locks again when time runs out", async () => {
    const { runner, clock, reports } = await setup("explorer.exe");
    await runner.dispatch({ type: "UNLOCK", durationSec: 60 });
    expect(runner.state.kind).toBe("UNLOCKED");
    expect(runner.remainingSec()).toBe(60);
    const saved = await readJson(paths.stateFile, PersistedState);
    expect(saved.ok && saved.value.state.kind).toBe("UNLOCKED");

    clock.advance(60_000);
    await runner.dispatch({ type: "TICK" });
    expect(runner.state.kind).toBe("LOCKED");
    expect(reports()).toBe(2);
  });

  it("restarts into maintenance only after the shell change is verified", async () => {
    const { runner, exec } = await setup("explorer.exe");
    await runner.dispatch({ type: "RESTORE_OK", maintenanceSec: 1800 });
    expect(runner.state.kind).toBe("MAINTENANCE");
    expect(restarts(exec).map((call) => call.args)).toEqual([["/r", "/t", "0"]]);
  });

  it("does NOT restart when the shell read-back is wrong", async () => {
    const { runner, exec } = await setup("broken.exe");
    await runner.dispatch({ type: "RESTORE_OK", maintenanceSec: 1800 });
    expect(restarts(exec)).toEqual([]);
  });

  it("processes events one at a time, in order", async () => {
    const order: string[] = [];
    const slow = async (effects: readonly Effect[]) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(effects.map((effect) => effect.type).join(","));
    };
    const runner = new StateRunner(LOCKED, new FakeClock(), slow, silentLogger);
    await Promise.all([
      runner.dispatch({ type: "UNLOCK", durationSec: 60 }),
      runner.dispatch({ type: "LOCK" }),
    ]);
    expect(order).toEqual(["PERSIST,REPORT", "PERSIST,REPORT"]);
    expect(runner.state.kind).toBe("LOCKED");
  });
});
