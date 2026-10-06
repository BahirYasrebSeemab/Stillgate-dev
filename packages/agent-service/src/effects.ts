import { assertNever, type Effect, type LockState } from "@stillgate/shared";
import type { Logger } from "@stillgate/shared/node";
import type { ConfigStore } from "./config";
import type { Clock } from "./deps";
import { saveState } from "./state/persist";
import type { EffectRunner } from "./state/runner";
import type { Lockdown } from "./windows/lockdown";
import type { Power } from "./windows/power";
import type { Registry } from "./windows/registry";
import { switchShell } from "./windows/shell-switch";

// Carries out the effects the reducer asked for, in order.
// SAFETY RULE: a RESTART only happens if every SET_SHELL in the same batch was verified.
// Restarting with a broken Shell value could leave the PC unusable.

export type EffectDeps = {
  readonly config: ConfigStore;
  readonly registry: Registry;
  readonly power: Power;
  readonly lockdown: Lockdown;
  readonly clock: Clock;
  readonly stateFile: string;
  readonly log: Logger;
  readonly report: () => void;
};

export function createEffectRunner(deps: EffectDeps): EffectRunner {
  return async (effects: readonly Effect[], state: LockState) => {
    let shellVerified = true;
    for (const effect of effects) {
      try {
        const ok = await runOne(effect, state, deps, shellVerified);
        if (effect.type === "SET_SHELL" && !ok) shellVerified = false;
      } catch (error) {
        if (effect.type === "SET_SHELL") shellVerified = false;
        deps.log.error("effect_failed", { effect: effect.type, error });
      }
    }
  };
}

async function runOne(effect: Effect, state: LockState, deps: EffectDeps, shellVerified: boolean): Promise<boolean> {
  const { kiosk, dryRun, policy } = deps.config.value;
  switch (effect.type) {
    case "SET_SHELL":
      if (kiosk === undefined) {
        deps.log.error("shell_switch_skipped", { reason: "kiosk user not configured (run agent init)" });
        return false;
      }
      return switchShell(deps.registry, kiosk, effect.target, deps.log, dryRun);
    case "RESTART":
      if (!shellVerified) {
        deps.log.error("restart_skipped", { reason: "shell change could not be verified; PC NOT restarted" });
        return false;
      }
      return deps.power.restart(effect.delaySec, effect.message);
    case "APPLY_LOCKDOWN":
      return deps.lockdown.apply(kiosk, policy.sites, dryRun);
    case "REMOVE_LOCKDOWN":
      return deps.lockdown.remove(kiosk, dryRun);
    case "PERSIST":
      await saveState(deps.stateFile, state, deps.clock);
      return true;
    case "REPORT":
      deps.report();
      return true;
    default:
      return assertNever(effect);
  }
}
