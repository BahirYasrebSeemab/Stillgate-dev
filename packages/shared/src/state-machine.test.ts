import { describe, expect, it } from "bun:test";
import {
  LOCKED,
  bootRule,
  reduce,
  remainingSec,
  type Effect,
  type LockState,
  type Now,
  type PersistedState,
} from "./state-machine";

const at = (mono: number, wall = 1_000_000): Now => ({ mono, wall });
const types = (effects: readonly Effect[]) => effects.map((effect) => effect.type);
const unlocked = (deadlineMono: number): LockState => ({ kind: "UNLOCKED", deadlineMono });
const maintenance = (deadlineWall: number): LockState => ({ kind: "MAINTENANCE", deadlineWall });

describe("reduce: LOCKED", () => {
  it("unlocks with a deadline counted from now", () => {
    const { state, effects } = reduce(LOCKED, { type: "UNLOCK", durationSec: 3600 }, at(5000));
    expect(state).toEqual(unlocked(5000 + 3_600_000));
    expect(types(effects)).toEqual(["PERSIST", "REPORT"]);
  });

  it("ignores extend, lock, rearm and tick", () => {
    for (const event of [{ type: "EXTEND", durationSec: 60 }, { type: "LOCK" }, { type: "REARM" }, { type: "TICK" }] as const) {
      expect(reduce(LOCKED, event, at(0))).toEqual({ state: LOCKED, effects: [] });
    }
  });

  it("enters maintenance on a correct restore password, then restarts at once", () => {
    const { state, effects } = reduce(LOCKED, { type: "RESTORE_OK", maintenanceSec: 1800 }, at(0, 10_000));
    expect(state).toEqual(maintenance(10_000 + 1_800_000));
    expect(types(effects)).toEqual(["REMOVE_LOCKDOWN", "SET_SHELL", "PERSIST", "REPORT", "RESTART"]);
    expect(effects).toContainEqual({ type: "SET_SHELL", target: "explorer" });
    expect(effects).toContainEqual({ type: "RESTART", delaySec: 0 });
  });
});

describe("reduce: UNLOCKED", () => {
  const state = unlocked(10_000);

  it("a new unlock replaces the deadline instead of adding to it", () => {
    expect(reduce(state, { type: "UNLOCK", durationSec: 60 }, at(9000)).state).toEqual(unlocked(69_000));
  });

  it("extend adds time to the existing deadline", () => {
    expect(reduce(state, { type: "EXTEND", durationSec: 60 }, at(9000)).state).toEqual(unlocked(70_000));
  });

  it("stays unlocked before the deadline", () => {
    expect(reduce(state, { type: "TICK" }, at(9999))).toEqual({ state, effects: [] });
  });

  it("locks exactly at the deadline", () => {
    const result = reduce(state, { type: "TICK" }, at(10_000));
    expect(result.state).toEqual(LOCKED);
    expect(types(result.effects)).toEqual(["PERSIST", "REPORT"]);
  });

  it("locks on a lock command", () => {
    expect(reduce(state, { type: "LOCK" }, at(0)).state).toEqual(LOCKED);
  });
});

describe("reduce: MAINTENANCE", () => {
  const state = maintenance(50_000);

  it("ignores unlock, lock, extend and another restore", () => {
    const events = [
      { type: "UNLOCK", durationSec: 60 },
      { type: "LOCK" },
      { type: "EXTEND", durationSec: 60 },
      { type: "RESTORE_OK", maintenanceSec: 60 },
    ] as const;
    for (const event of events) expect(reduce(state, event, at(0, 0))).toEqual({ state, effects: [] });
  });

  it("rearm locks, switches the shell back and restarts after 60 s", () => {
    const { state: next, effects } = reduce(state, { type: "REARM" }, at(0, 0));
    expect(next).toEqual(LOCKED);
    expect(effects).toContainEqual({ type: "SET_SHELL", target: "kiosk" });
    expect(effects.find((effect) => effect.type === "RESTART")).toMatchObject({ delaySec: 60 });
  });

  it("uses the wall clock deadline", () => {
    expect(reduce(state, { type: "TICK" }, at(999_999, 49_999)).state).toEqual(state);
    expect(reduce(state, { type: "TICK" }, at(0, 50_000)).state).toEqual(LOCKED);
  });
});

describe("bootRule", () => {
  const BOOT = 1_000_000;
  const saved = (state: LockState, bootWallMs = BOOT): PersistedState => ({
    schemaVersion: 1,
    state,
    bootWallMs,
    savedAtWall: BOOT + 5000,
  });

  it("starts LOCKED with lockdown when nothing was saved", () => {
    const result = bootRule(null, BOOT, at(0));
    expect(result.state).toEqual(LOCKED);
    expect(types(result.effects)).toContain("APPLY_LOCKDOWN");
    expect(result.effects).toContainEqual({ type: "SET_SHELL", target: "kiosk" });
  });

  it("discards an UNLOCKED state after a reboot", () => {
    const result = bootRule(saved(unlocked(999_999_999), BOOT), BOOT + 10 * 60_000, at(0));
    expect(result.state).toEqual(LOCKED);
  });

  it("keeps an UNLOCKED state after a service restart in the same boot", () => {
    const result = bootRule(saved(unlocked(80_000), BOOT), BOOT + 1000, at(50_000));
    expect(result.state).toEqual(unlocked(80_000));
  });

  it("locks an UNLOCKED state whose deadline passed while the service was down", () => {
    expect(bootRule(saved(unlocked(40_000)), BOOT, at(50_000)).state).toEqual(LOCKED);
  });

  it("keeps MAINTENANCE across a reboot", () => {
    const state = maintenance(BOOT + 60_000);
    expect(bootRule(saved(state), BOOT + 999_999, at(0, BOOT + 1000))).toEqual({ state, effects: [] });
  });

  it("ends an expired MAINTENANCE on boot and switches the shell back", () => {
    const result = bootRule(saved(maintenance(BOOT)), BOOT, at(0, BOOT + 1));
    expect(result.state).toEqual(LOCKED);
    expect(result.effects).toContainEqual({ type: "SET_SHELL", target: "kiosk" });
  });
});

describe("remainingSec", () => {
  it("rounds up and never goes below zero", () => {
    expect(remainingSec(LOCKED, at(0))).toBeNull();
    expect(remainingSec(unlocked(10_001), at(0))).toBe(11);
    expect(remainingSec(unlocked(10_000), at(20_000))).toBe(0);
    expect(remainingSec(maintenance(5000), at(0, 0))).toBe(5);
  });
});
