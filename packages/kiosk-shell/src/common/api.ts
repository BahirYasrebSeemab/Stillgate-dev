// Types shared by the kiosk shell's main process, preload and React UI. TYPES ONLY
// (the sandboxed preload can't load other files at runtime; it uses `import type`).

import type { AppId, Result, ShellState, SiteId } from "@asd/shared";

// What the UI shows. `null` state = the agent service can't be reached (show the locked page).
export type KioskView = {
  readonly state: ShellState | null;
  readonly receivedAt: number; // for counting down locally between updates
};

export type RestoreFailure =
  | { readonly reason: "wrong_password" }
  | { readonly reason: "locked_out"; readonly retryAfterSec: number }
  | { readonly reason: "no_password_set" }
  | { readonly reason: "service_unavailable" };

export interface KioskApi {
  getView(): Promise<KioskView>;
  onView(listener: (view: KioskView) => void): () => void;
  launchApp(id: AppId): Promise<Result<true, string>>;
  openSite(id: SiteId): Promise<Result<true, string>>;
  appIcon(id: AppId): Promise<string | null>; // data: URL of the program's icon
  siteIcon(id: SiteId): Promise<string | null>; // data: URL of the website's icon
  restore(password: string): Promise<Result<true, RestoreFailure>>;
}

export type InvokeChannel =
  | "kiosk:view"
  | "kiosk:launch"
  | "kiosk:open"
  | "kiosk:icon"
  | "kiosk:siteIcon"
  | "kiosk:restore";
export type PushChannel = "kiosk:update";
