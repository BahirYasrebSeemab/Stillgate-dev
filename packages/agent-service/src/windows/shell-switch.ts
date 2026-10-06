import type { Logger } from "@stillgate/shared/node";
import type { KioskConfig } from "../config";
import { withKioskHive } from "./kiosk-hive";
import type { Registry } from "./registry";

// Chooses what program Windows starts as the kiosk user's "desktop" (shell):
//   kiosk    -> our kiosk-shell exe   (LOCKED / UNLOCKED)
//   explorer -> the normal Windows desktop (MAINTENANCE)
// Written per user: HKU\<kiosk SID>\Software\Microsoft\Windows NT\CurrentVersion\Winlogon -> Shell.
// Other users (the admin account) are never touched.
// RULE: write, read back, and only report success if the read-back matches.
// The caller must not restart the PC unless this returned true.
// In dry-run mode the write is only logged, so the read-back is skipped and counted as success.
// UNTESTED(windows)

const WINLOGON = "Software\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon";

export type ShellTarget = "kiosk" | "explorer";

export async function switchShell(
  registry: Registry,
  kiosk: KioskConfig,
  target: ShellTarget,
  log: Logger,
  dryRun: boolean,
): Promise<boolean> {
  const wanted = target === "kiosk" ? kiosk.shellExe : "explorer.exe";
  if (dryRun) {
    await registry.setString(`HKU\\${kiosk.sid}\\${WINLOGON}`, "Shell", wanted); // logged only
    return true;
  }
  const verified = await withKioskHive(registry, kiosk, log, false, async (root) => {
    const key = `${root}\\${WINLOGON}`;
    const written = await registry.setString(key, "Shell", wanted);
    if (!written.ok) {
      log.error("shell_write_failed", { target, detail: written.detail });
      return false;
    }
    const readBack = await registry.query(key, "Shell");
    if (readBack !== wanted) {
      log.error("shell_readback_mismatch", { target, wanted, readBack });
      return false;
    }
    return true;
  });
  if (verified === true) log.info("shell_switched", { target, shell: wanted });
  return verified === true;
}
