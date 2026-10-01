import { EDGE_LIST_POLICIES, buildBrowserPolicy, type EdgeDwordPolicy, type SiteEntry } from "@asd/shared";
import type { Logger } from "@asd/shared/node";
import type { KioskConfig } from "../config";
import { withKioskHive } from "./kiosk-hive";
import type { Registry } from "./registry";

// Applied in LOCKED/UNLOCKED, removed in MAINTENANCE so the admin is not restricted.
// UNTESTED(windows): every value below. VERIFY the per-user value names on a test PC
// (they are the documented "Ctrl+Alt+Del Options" / System policies).

const EDGE_KEY = "HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge";

// Per-user values, under the kiosk user's hive
const USER_POLICIES: readonly { readonly key: string; readonly name: string; readonly value: number }[] = [
  // Ctrl+Alt+Del screen: no Task Manager, no Lock, no Change password
  { key: "Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System", name: "DisableTaskMgr", value: 1 },
  { key: "Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System", name: "DisableLockWorkstation", value: 1 },
  { key: "Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System", name: "DisableChangePassword", value: 1 },
  // No registry editor
  { key: "Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System", name: "DisableRegistryTools", value: 1 },
  // No "Sign out": a signed-out kiosk user lands on a password screen and the PC is stuck
  { key: "Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer", name: "NoLogoff", value: 1 },
];

export class Lockdown {
  constructor(
    private readonly registry: Registry,
    private readonly log: Logger,
  ) {}

  async apply(kiosk: KioskConfig | undefined, sites: readonly SiteEntry[], dryRun: boolean): Promise<boolean> {
    const edgeOk = await this.applyEdge(sites);
    const userOk = kiosk === undefined ? this.missingKiosk() : await this.setUserPolicies(kiosk, true, dryRun);
    return edgeOk && userOk;
  }

  async remove(kiosk: KioskConfig | undefined, dryRun: boolean): Promise<boolean> {
    const edgeOk = await this.removeEdge();
    const userOk = kiosk === undefined ? this.missingKiosk() : await this.setUserPolicies(kiosk, false, dryRun);
    return edgeOk && userOk;
  }

  // Lists: delete the whole subkey, then re-add numbered values 1, 2, 3, ...
  private async applyEdge(sites: readonly SiteEntry[]): Promise<boolean> {
    const policy = buildBrowserPolicy(sites);
    let ok = true;
    for (const listName of EDGE_LIST_POLICIES) {
      const key = `${EDGE_KEY}\\${listName}`;
      await this.registry.deleteKey(key); // fails harmlessly if it does not exist yet
      const entries = policy.lists[listName];
      for (const [index, entry] of entries.entries()) {
        ok = (await this.registry.setString(key, String(index + 1), entry)).ok && ok;
      }
    }
    for (const [name, value] of Object.entries(policy.dwords) as [EdgeDwordPolicy, number][]) {
      ok = (await this.registry.setDword(EDGE_KEY, name, value)).ok && ok;
    }
    this.log.info("edge_policy_applied", { sites: sites.length, ok });
    return ok;
  }

  private async removeEdge(): Promise<boolean> {
    const policy = buildBrowserPolicy([]);
    for (const listName of EDGE_LIST_POLICIES) await this.registry.deleteKey(`${EDGE_KEY}\\${listName}`);
    for (const name of Object.keys(policy.dwords)) await this.registry.deleteValue(EDGE_KEY, name);
    this.log.info("edge_policy_removed");
    return true;
  }

  private async setUserPolicies(kiosk: KioskConfig, enable: boolean, dryRun: boolean): Promise<boolean> {
    const result = await withKioskHive(this.registry, kiosk, this.log, dryRun, async (root) => {
      let ok = true;
      for (const policy of USER_POLICIES) {
        const key = `${root}\\${policy.key}`;
        const step = enable
          ? await this.registry.setDword(key, policy.name, policy.value)
          : await this.registry.deleteValue(key, policy.name);
        ok = (step.ok || !enable) && ok; // deleting a value that is already gone is fine
      }
      return ok;
    });
    this.log.info(enable ? "user_lockdown_applied" : "user_lockdown_removed", { ok: result === true });
    return result === true;
  }

  private missingKiosk(): boolean {
    this.log.warn("kiosk_not_configured", { hint: "run: agent init --kiosk-user ... --kiosk-sid ... --shell-exe ..." });
    return false;
  }
}
