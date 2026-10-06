import type { Logger } from "@stillgate/shared/node";
import type { KioskConfig } from "../config";
import type { Registry } from "./registry";

// The kiosk user's personal registry (HKEY_USERS\<SID>) is only "mounted" while
// that user is signed in. When it isn't, we mount their NTUSER.DAT file ourselves,
// do the work, and unmount it again.
// UNTESTED(windows): reg load / reg unload of another user's hive.

const MOUNT_NAME = "HKU\\StillgateKiosk";
const PROFILE_LIST = "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ProfileList";

export async function withKioskHive<T>(
  registry: Registry,
  kiosk: KioskConfig,
  log: Logger,
  dryRun: boolean,
  work: (root: string) => Promise<T>,
): Promise<T | null> {
  const loadedRoot = `HKU\\${kiosk.sid}`;
  // Dry run: writes are only logged anyway, so don't mount anything
  if (dryRun || (await registry.keyExists(loadedRoot))) return work(loadedRoot);

  const profileDir = await registry.query(`${PROFILE_LIST}\\${kiosk.sid}`, "ProfileImagePath");
  if (profileDir === null) {
    log.error("kiosk_profile_not_found", { sid: kiosk.sid });
    return null;
  }
  const hiveFile = `${expandEnv(profileDir)}\\NTUSER.DAT`;
  const loaded = await registry.load(MOUNT_NAME, hiveFile);
  if (!loaded.ok) {
    log.error("kiosk_hive_load_failed", { hiveFile, detail: loaded.detail });
    return null;
  }
  try {
    return await work(MOUNT_NAME);
  } finally {
    const unloaded = await registry.unload(MOUNT_NAME);
    if (!unloaded.ok) log.warn("kiosk_hive_unload_failed", { detail: unloaded.detail });
  }
}

// ProfileImagePath is stored as e.g. "%SystemDrive%\Users\kiosk"
function expandEnv(path: string): string {
  return path.replace(/%([^%]+)%/g, (whole, name: string) => process.env[name] ?? whole);
}
