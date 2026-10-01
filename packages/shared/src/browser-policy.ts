import type { SiteEntry } from "./policy";

// Microsoft Edge policy values, written by the agent under
// HKLM\SOFTWARE\Policies\Microsoft\Edge. Names and values checked against
// Microsoft Learn "Microsoft Edge Browser Policy Documentation" (2026).
//   lists  -> a subkey with numbered REG_SZ values 1, 2, 3, ...
//   dwords -> REG_DWORD values directly under the Edge key

export type EdgePolicy = {
  readonly lists: Readonly<Record<EdgeListPolicy, readonly string[]>>;
  readonly dwords: Readonly<Record<EdgeDwordPolicy, number>>;
};

export const EDGE_LIST_POLICIES = ["URLBlocklist", "URLAllowlist"] as const;
export type EdgeListPolicy = (typeof EDGE_LIST_POLICIES)[number];

export const EDGE_HARDENING = {
  InPrivateModeAvailability: 1, // 1 = InPrivate disabled
  BrowserGuestModeEnabled: 0, // guest profiles off
  BrowserAddProfileEnabled: 0, // no new profiles
  DeveloperToolsAvailability: 2, // 2 = developer tools not allowed
  DownloadRestrictions: 3, // 3 = block all downloads
  HideFirstRunExperience: 1, // no first-run wizard for visitors
  StartupBoostEnabled: 0, // no Edge processes left running in the background
  BackgroundModeEnabled: 0,
} as const;
export type EdgeDwordPolicy = keyof typeof EDGE_HARDENING;

// Everything is blocked ("*"), then only the allowed site patterns are let through.
// Sites must already be validated (SiteEntry schema does that).
export function buildBrowserPolicy(sites: readonly SiteEntry[]): EdgePolicy {
  return {
    lists: {
      URLBlocklist: ["*"],
      URLAllowlist: [...new Set(sites.map((site) => site.pattern))],
    },
    dwords: { ...EDGE_HARDENING },
  };
}
