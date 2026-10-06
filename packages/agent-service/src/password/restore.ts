import { DEFAULT_MAINTENANCE_SEC, err, ok, type PasswordRecord, type Result, type ShellErrorCode } from "@stillgate/shared";
import { verifyPassword, type Logger } from "@stillgate/shared/node";
import { FRESH_LIMIT, recordFailure, retryAfterSec, type RateLimit } from "./rate-limit";

// Checks the restore password typed into the kiosk shell's hotkey panel.
// Works fully offline: the hash is stored locally. The password is never logged.

export type RestoreError = { readonly code: ShellErrorCode; readonly retryAfterSec?: number };

export type RestoreDeps = {
  readonly log: Logger;
  readonly nowMs: () => number; // monotonic, so changing the clock can't skip a lockout
  readonly passwordRecord: () => PasswordRecord | undefined;
  readonly enterMaintenance: (maintenanceSec: number) => Promise<void>;
  readonly reportEvent: (kind: string, detail: string) => void;
};

export class RestoreGuard {
  private limit: RateLimit = FRESH_LIMIT;

  constructor(private readonly deps: RestoreDeps) {}

  async attempt(password: string): Promise<Result<true, RestoreError>> {
    const wait = retryAfterSec(this.limit, this.deps.nowMs());
    if (wait !== null) return err({ code: "locked_out", retryAfterSec: wait });

    const record = this.deps.passwordRecord();
    if (record === undefined) {
      this.deps.log.warn("restore_no_password", { hint: "PC not paired yet; use the administrator account" });
      return err({ code: "no_password_set" });
    }

    if (!(await verifyPassword(password, record))) {
      this.limit = recordFailure(this.limit, this.deps.nowMs());
      const lockedFor = retryAfterSec(this.limit, this.deps.nowMs());
      this.deps.log.warn("restore_failed", { failuresSinceLockout: this.limit.failures, lockedFor });
      this.deps.reportEvent("restore_failed", lockedFor === null ? "wrong password" : `locked for ${lockedFor}s`);
      return lockedFor === null
        ? err({ code: "wrong_password" })
        : err({ code: "locked_out", retryAfterSec: lockedFor });
    }

    this.limit = FRESH_LIMIT;
    this.deps.log.info("restore_ok");
    this.deps.reportEvent("restore_ok", "maintenance mode started from the PC");
    await this.deps.enterMaintenance(DEFAULT_MAINTENANCE_SEC);
    return ok(true);
  }
}
