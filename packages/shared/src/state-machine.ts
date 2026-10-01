import { z } from "zod";
import { REARM_RESTART_DELAY_SEC } from "./constants";

// ---------- Types ----------

// Time is passed in, never read inside, so the reducer is fully testable.
// mono = monotonic clock (ms): never jumps when someone changes the system clock.
// wall = wall clock (ms since 1970): survives reboots, used for MAINTENANCE only.
export type Now = { readonly mono: number; readonly wall: number };

export const LockState = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("LOCKED") }),
  z.strictObject({ kind: z.literal("UNLOCKED"), deadlineMono: z.number() }),
  z.strictObject({ kind: z.literal("MAINTENANCE"), deadlineWall: z.number() }),
]);
export type LockState = z.infer<typeof LockState>;

export type LockEvent =
  | { readonly type: "UNLOCK"; readonly durationSec: number }
  | { readonly type: "LOCK" }
  | { readonly type: "EXTEND"; readonly durationSec: number }
  | { readonly type: "RESTORE_OK"; readonly maintenanceSec: number }
  | { readonly type: "REARM" }
  | { readonly type: "TICK" };

// Side effects the agent must carry out after a transition (the reducer only describes them)
export type Effect =
  | { readonly type: "SET_SHELL"; readonly target: "kiosk" | "explorer" }
  | { readonly type: "RESTART"; readonly delaySec: number; readonly message?: string }
  | { readonly type: "APPLY_LOCKDOWN" }
  | { readonly type: "REMOVE_LOCKDOWN" }
  | { readonly type: "PERSIST" }
  | { readonly type: "REPORT" };

export type Transition = { readonly state: LockState; readonly effects: readonly Effect[] };

export const LOCKED: LockState = { kind: "LOCKED" };
export const REARM_MESSAGE = "Maintenance finished. This computer restarts in 60 seconds.";

const SAVE_AND_REPORT: readonly Effect[] = [{ type: "PERSIST" }, { type: "REPORT" }];

const ENTER_MAINTENANCE: readonly Effect[] = [
  { type: "REMOVE_LOCKDOWN" },
  { type: "SET_SHELL", target: "explorer" },
  ...SAVE_AND_REPORT,
  { type: "RESTART", delaySec: 0 },
];

const LEAVE_MAINTENANCE: readonly Effect[] = [
  { type: "SET_SHELL", target: "kiosk" },
  { type: "APPLY_LOCKDOWN" },
  ...SAVE_AND_REPORT,
  { type: "RESTART", delaySec: REARM_RESTART_DELAY_SEC, message: REARM_MESSAGE },
];

// ---------- Reducer ----------

export function reduce(state: LockState, event: LockEvent, now: Now): Transition {
  switch (state.kind) {
    case "LOCKED":
      return fromLocked(event, now);
    case "UNLOCKED":
      return fromUnlocked(state, event, now);
    case "MAINTENANCE":
      return fromMaintenance(state, event, now);
    default:
      return assertNever(state);
  }
}

function fromLocked(event: LockEvent, now: Now): Transition {
  switch (event.type) {
    case "UNLOCK":
      return to(unlockedUntil(now.mono, event.durationSec), SAVE_AND_REPORT);
    case "RESTORE_OK":
      return to(maintenanceUntil(now.wall, event.maintenanceSec), ENTER_MAINTENANCE);
    case "LOCK":
    case "EXTEND":
    case "REARM":
    case "TICK":
      return stay(LOCKED);
    default:
      return assertNever(event);
  }
}

function fromUnlocked(state: Extract<LockState, { kind: "UNLOCKED" }>, event: LockEvent, now: Now): Transition {
  switch (event.type) {
    case "UNLOCK": // a new unlock replaces the old deadline, counted from now
      return to(unlockedUntil(now.mono, event.durationSec), SAVE_AND_REPORT);
    case "EXTEND":
      return to({ kind: "UNLOCKED", deadlineMono: state.deadlineMono + event.durationSec * 1000 }, SAVE_AND_REPORT);
    case "LOCK":
      return to(LOCKED, SAVE_AND_REPORT);
    case "TICK":
      return now.mono >= state.deadlineMono ? to(LOCKED, SAVE_AND_REPORT) : stay(state);
    case "RESTORE_OK":
      return to(maintenanceUntil(now.wall, event.maintenanceSec), ENTER_MAINTENANCE);
    case "REARM":
      return stay(state);
    default:
      return assertNever(event);
  }
}

function fromMaintenance(
  state: Extract<LockState, { kind: "MAINTENANCE" }>,
  event: LockEvent,
  now: Now,
): Transition {
  switch (event.type) {
    case "REARM":
      return to(LOCKED, LEAVE_MAINTENANCE);
    case "TICK":
      return now.wall >= state.deadlineWall ? to(LOCKED, LEAVE_MAINTENANCE) : stay(state);
    case "UNLOCK":
    case "LOCK":
    case "EXTEND":
    case "RESTORE_OK":
      return stay(state);
    default:
      return assertNever(event);
  }
}

// ---------- Boot rule ----------

// What the agent saves to disk after every transition
export const PersistedState = z.strictObject({
  schemaVersion: z.literal(1),
  state: LockState,
  bootWallMs: z.number(),
  savedAtWall: z.number(),
});
export type PersistedState = z.infer<typeof PersistedState>;

// Two boot-time estimates closer than this are treated as the same boot
export const SAME_BOOT_TOLERANCE_MS = 120_000;

// Decides the starting state when the agent (re)starts.
// - MAINTENANCE survives reboots (that is how the restore works), unless it already expired.
// - UNLOCKED survives only a service restart within the same boot, never a reboot.
// - Everything else starts LOCKED, and lockdown is re-applied every time (self-healing).
export function bootRule(saved: PersistedState | null, bootWallMs: number, now: Now): Transition {
  const ensureLocked: Transition = {
    state: LOCKED,
    effects: [{ type: "SET_SHELL", target: "kiosk" }, { type: "APPLY_LOCKDOWN" }, ...SAVE_AND_REPORT],
  };
  if (saved === null) return ensureLocked;

  const { state } = saved;
  switch (state.kind) {
    case "MAINTENANCE":
      return now.wall < state.deadlineWall ? stay(state) : to(LOCKED, LEAVE_MAINTENANCE);
    case "UNLOCKED": {
      const sameBoot = Math.abs(saved.bootWallMs - bootWallMs) <= SAME_BOOT_TOLERANCE_MS;
      const stillValid = now.mono < state.deadlineMono;
      return sameBoot && stillValid
        ? { state, effects: [{ type: "APPLY_LOCKDOWN" }, { type: "REPORT" }] }
        : ensureLocked;
    }
    case "LOCKED":
      return ensureLocked;
    default:
      return assertNever(state);
  }
}

// ---------- Helpers ----------

// Seconds left in the current state, rounded up; null when LOCKED
export function remainingSec(state: LockState, now: Now): number | null {
  switch (state.kind) {
    case "LOCKED":
      return null;
    case "UNLOCKED":
      return Math.max(0, Math.ceil((state.deadlineMono - now.mono) / 1000));
    case "MAINTENANCE":
      return Math.max(0, Math.ceil((state.deadlineWall - now.wall) / 1000));
    default:
      return assertNever(state);
  }
}

function unlockedUntil(monoMs: number, durationSec: number): LockState {
  return { kind: "UNLOCKED", deadlineMono: monoMs + durationSec * 1000 };
}

function maintenanceUntil(wallMs: number, maintenanceSec: number): LockState {
  return { kind: "MAINTENANCE", deadlineWall: wallMs + maintenanceSec * 1000 };
}

function to(state: LockState, effects: readonly Effect[]): Transition {
  return { state, effects };
}

function stay(state: LockState): Transition {
  return { state, effects: [] };
}

// If a new state or event is added and not handled above, this line stops compiling
export function assertNever(value: never): never {
  throw new Error(`unhandled case: ${JSON.stringify(value)}`);
}
