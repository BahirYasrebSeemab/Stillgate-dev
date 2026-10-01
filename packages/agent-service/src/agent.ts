import { dirname } from "node:path";
import {
  APP_VERSION,
  bootRule,
  err,
  ok,
  siteUrl,
  type AppId,
  type Result,
  type ShellErrorCode,
  type ShellState,
  type ShellTokenFile,
  type SiteId,
} from "@asd/shared";
import { randomHex, writeJsonAtomic, type Logger } from "@asd/shared/node";
import { handleServerCommand } from "./commands";
import { ConfigStore, pairingOf } from "./config";
import { processControlRequests, type ControlRequest } from "./control";
import type { Clock } from "./deps";
import { createEffectRunner } from "./effects";
import { ProcessWatcher } from "./enforcer/watcher";
import type { AgentPaths } from "./paths";
import { RestoreGuard } from "./password/restore";
import { ServerLink, type StateReport } from "./server-link/client";
import { ShellIpcServer } from "./shell-ipc/server";
import { loadState } from "./state/persist";
import { StateRunner } from "./state/runner";
import { createExec, type Exec } from "./windows/exec";
import { Lockdown } from "./windows/lockdown";
import { Power } from "./windows/power";
import { Registry } from "./windows/registry";

// Wires every part of the agent together. main.ts only starts and stops it.

const CONTROL_POLL_MS = 1000;
const DEFAULT_KIOSK_DIR = "C:\\Program Files\\AsdLabLock\\kiosk-shell";

export type Agent = { start(): Promise<void>; stop(): Promise<void> };

export async function createAgent(paths: AgentPaths, clock: Clock, log: Logger, exec?: Exec): Promise<Agent> {
  const config = await ConfigStore.load(paths.configFile, log);
  const run = exec ?? createExec({ dryRun: () => config.value.dryRun, log });
  const registry = new Registry(run);
  const power = new Power(run, log);
  const lockdown = new Lockdown(registry, log);

  const boot = bootRule(await loadState(paths.stateFile, log), clock.bootWallMs(), {
    mono: clock.monoMs(),
    wall: clock.wallMs(),
  });
  log.info("agent_boot", { state: boot.state.kind, version: APP_VERSION, dryRun: config.value.dryRun });

  // Filled in below; the effect runner needs them, and they need the runner (a cycle)
  let link: ServerLink | null = null;
  let ipc: ShellIpcServer | null = null;
  const notifyChange = (): void => {
    link?.sendStateReport();
    ipc?.pushState();
  };

  const runner = new StateRunner(
    boot.state,
    clock,
    createEffectRunner({ config, registry, power, lockdown, clock, stateFile: paths.stateFile, log, report: notifyChange }),
    log,
  );
  const reapplyLockdown = async (): Promise<void> => {
    if (runner.state.kind !== "MAINTENANCE") await runner.runInitialEffects([{ type: "APPLY_LOCKDOWN" }]);
  };

  const buildReport = (): StateReport => ({
    type: "state_report",
    state: runner.state.kind,
    remainingSec: runner.remainingSec(),
    enforcement: config.value.enforcement,
    dryRun: config.value.dryRun,
    passwordVersion: config.value.password?.version ?? 0,
    policyVersion: config.value.policy.version,
    agentVersion: APP_VERSION,
  });

  link = new ServerLink({
    log,
    pairing: () => pairingOf(config.value),
    buildReport,
    onCommand: (command) =>
      handleServerCommand(command, { runner, config, power, log, reapplyLockdown, notifyChange }),
    onOnlineChange: () => ipc?.pushState(),
  });

  const restoreGuard = new RestoreGuard({
    log,
    nowMs: () => clock.monoMs(),
    passwordRecord: () => config.value.password,
    enterMaintenance: (maintenanceSec) => runner.dispatch({ type: "RESTORE_OK", maintenanceSec }),
    reportEvent: (kind, detail) => link?.sendEvent(kind, detail),
  });

  const token = randomHex(32);
  ipc = new ShellIpcServer({
    log,
    port: config.value.shellIpcPort,
    token,
    getState: () => shellState(runner, config, link),
    launchApp: (id) => launchSpec(runner, config, id),
    openSite: (id) => siteSpec(runner, config, id),
    restore: (password) => restoreGuard.attempt(password),
  });

  const watcher = new ProcessWatcher({
    exec: run,
    log,
    config: () => config.value,
    lockState: () => runner.state.kind,
    kioskShellDir: () => (config.value.kiosk === undefined ? DEFAULT_KIOSK_DIR : dirname(config.value.kiosk.shellExe)),
    windowsDir: process.env["SystemRoot"] ?? "C:\\Windows",
  });

  const onControl = async (request: ControlRequest): Promise<void> => {
    switch (request.cmd) {
      case "rearm":
        return runner.dispatch({ type: "REARM" });
      case "reload":
        await config.reload(log);
        await reapplyLockdown();
        return notifyChange();
      case "set-enforcement":
        await config.update((current) => ({ ...current, enforcement: request.mode }));
        return notifyChange();
      case "set-dry-run":
        await config.update((current) => ({ ...current, dryRun: request.value }));
        return notifyChange();
    }
  };

  let controlTimer: NodeJS.Timeout | null = null;
  runner.on("change", () => ipc?.pushState());

  return {
    async start() {
      const tokenFile: ShellTokenFile = { schemaVersion: 1, token, port: config.value.shellIpcPort };
      await writeJsonAtomic(paths.tokenFile, tokenFile);
      await ipc.start();
      await runner.runInitialEffects(boot.effects);
      runner.startTicking();
      link.start();
      watcher.start();
      controlTimer = setInterval(() => {
        processControlRequests(paths.controlDir, log, onControl).catch((error: unknown) =>
          log.error("control_failed", { error }),
        );
      }, CONTROL_POLL_MS);
      log.info("agent_started", { shellIpcPort: config.value.shellIpcPort });
    },
    async stop() {
      if (controlTimer !== null) clearInterval(controlTimer);
      watcher.stop();
      link.stop();
      runner.stopTicking();
      await ipc.stop();
      log.info("agent_stopped");
    },
  };
}

function shellState(runner: StateRunner, config: ConfigStore, link: ServerLink | null): ShellState {
  const unlocked = runner.state.kind === "UNLOCKED";
  const { policy } = config.value;
  return {
    lock: runner.state.kind,
    remainingSec: runner.remainingSec(),
    serverOnline: link?.isOnline() ?? false,
    apps: unlocked
      ? policy.apps.map((app) => ({
          id: app.id,
          name: app.name,
          exePath: app.exePath,
          ...(app.iconPath === undefined ? {} : { iconPath: app.iconPath }),
        }))
      : [],
    sites: unlocked ? policy.sites.map((site) => ({ id: site.id, name: site.name })) : [],
  };
}

function launchSpec(
  runner: StateRunner,
  config: ConfigStore,
  id: AppId,
): Result<{ exePath: string; args: string[] }, ShellErrorCode> {
  if (runner.state.kind !== "UNLOCKED") return err("not_allowed");
  const app = config.value.policy.apps.find((entry) => entry.id === id);
  return app === undefined ? err("not_allowed") : ok({ exePath: app.exePath, args: [...(app.args ?? [])] });
}

function siteSpec(runner: StateRunner, config: ConfigStore, id: SiteId): Result<{ url: string }, ShellErrorCode> {
  if (runner.state.kind !== "UNLOCKED") return err("not_allowed");
  const site = config.value.policy.sites.find((entry) => entry.id === id);
  return site === undefined ? err("not_allowed") : ok({ url: siteUrl(site.pattern) });
}
