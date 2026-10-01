import type { Logger } from "@asd/shared/node";
import type { ConfigStore } from "./config";
import type { ServerCommand } from "./server-link/client";
import type { StateRunner } from "./state/runner";
import type { Power } from "./windows/power";

// What the agent does with each command from the manager.
// Every command was already validated by zod in parseServerMessage.

export type CommandDeps = {
  readonly runner: StateRunner;
  readonly config: ConfigStore;
  readonly power: Power;
  readonly log: Logger;
  readonly reapplyLockdown: () => Promise<void>;
  readonly notifyChange: () => void;
};

export async function handleServerCommand(command: ServerCommand, deps: CommandDeps): Promise<void> {
  deps.log.info("server_command", { type: command.type });
  switch (command.type) {
    case "unlock":
      return deps.runner.dispatch({ type: "UNLOCK", durationSec: command.durationSec });
    case "extend":
      return deps.runner.dispatch({ type: "EXTEND", durationSec: command.durationSec });
    case "lock":
      return deps.runner.dispatch({ type: "LOCK" });
    case "rearm":
      return deps.runner.dispatch({ type: "REARM" });
    case "policy":
      await deps.config.update((config) => ({ ...config, policy: command.policy }));
      await deps.reapplyLockdown(); // Edge allow-list may have changed
      return deps.notifyChange();
    case "password_update": {
      const current = deps.config.value.password;
      if (current !== undefined && command.record.version <= current.version) return;
      await deps.config.update((config) => ({ ...config, password: command.record }));
      deps.log.info("password_updated", { version: command.record.version });
      return deps.notifyChange();
    }
    case "power":
      if (command.action === "restart") await deps.power.restart(0);
      else await deps.power.shutdown();
      return;
  }
}
