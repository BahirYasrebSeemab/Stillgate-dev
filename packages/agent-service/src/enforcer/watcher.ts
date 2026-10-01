import type { LockStateName, Policy } from "@asd/shared";
import type { Logger } from "@asd/shared/node";
import type { AgentConfig } from "../config";
import type { Exec } from "../windows/exec";
import { decideKills } from "./decide";
import { userName, type ProcessSource } from "./processes";

// Every 2 seconds (after the previous round finished): list the kiosk user's processes, decide, and close what is not allowed.
// enforcement = "audit"   -> only log what WOULD be closed (default, safe)
// enforcement = "enforce" -> taskkill /PID <pid> /F   (/F = force)
// Only processes owned by the kiosk user are ever touched.
// UNTESTED(windows)

const INTERVAL_MS = 2000;

export type WatcherDeps = {
  readonly exec: Exec;
  readonly log: Logger;
  readonly config: () => AgentConfig;
  readonly lockState: () => LockStateName;
  readonly kioskShellDir: () => string;
  readonly windowsDir: string;
  readonly source: ProcessSource;
};

export class ProcessWatcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  // Remember what was already reported, so audit mode doesn't log the same process every 2 s
  private reported = new Set<string>();

  constructor(private readonly deps: WatcherDeps) {}

  start(): void {
    this.running = true;
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.deps.source.close();
  }

  async runOnce(): Promise<number> {
    const config = this.deps.config();
    const kiosk = config.kiosk;
    if (kiosk === undefined) return 0;

    const all = await this.deps.source.list();
    if (all === null) return 0;
    const kioskUser = kiosk.user.toLowerCase();
    const mine = all.filter((process) => userName(process.user)?.toLowerCase() === kioskUser);

    const decisions = decideKills({
      processes: mine,
      state: this.deps.lockState(),
      policy: config.policy satisfies Policy,
      kioskShellDir: this.deps.kioskShellDir(),
      windowsDir: this.deps.windowsDir,
    });

    const seen = new Set<string>();
    for (const decision of decisions) {
      const key = `${decision.pid}:${decision.path}`;
      seen.add(key);
      if (config.enforcement === "audit") {
        if (!this.reported.has(key)) this.deps.log.info("would_kill", { ...decision });
        continue;
      }
      const result = await this.deps.exec.run("taskkill", ["/PID", String(decision.pid), "/F"], { mutates: true });
      if (result.code === 0) this.deps.log.info("killed", { ...decision });
      else this.deps.log.warn("kill_failed", { ...decision, detail: result.stderr.slice(0, 200) });
    }
    this.reported = seen;
    return decisions.length;
  }

  private schedule(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.runOnce()
        .catch((error: unknown) => this.deps.log.error("watcher_error", { error }))
        .finally(() => this.schedule(INTERVAL_MS));
    }, delayMs);
  }
}
