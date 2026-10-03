import { nativeImage, net } from "electron";
import type { Logger } from "@asd/shared/node";

// Fetches the icon of an allowed website for its launcher tile.
// Safety rules:
//   - only called for sites the agent currently allows (see ipc.ts), only http(s)
//   - 5 s timeout, at most 256 KB, no cookies of ours (the kiosk session has none)
//   - the bytes are decoded and RE-ENCODED by Electron (nativeImage -> PNG data URL),
//     so the page only ever gets a clean image, and its CSP still allows no network access
// Tries the big "apple-touch-icon.png" first (sharp on large tiles), then "favicon.ico".

const CANDIDATE_PATHS = ["/apple-touch-icon.png", "/favicon.ico"];
const TIMEOUT_MS = 5000;
const MAX_ICON_BYTES = 256 * 1024;
const ICON_SIZE = 64;
const RETRY_FAILED_AFTER_MS = 5 * 60_000; // e.g. the PC was offline at first

export class SiteIcons {
  private readonly cache = new Map<string, Promise<string | null>>();

  constructor(private readonly log: Logger) {}

  get(url: string): Promise<string | null> {
    const origin = httpOrigin(url);
    if (origin === null) return Promise.resolve(null);
    let pending = this.cache.get(origin);
    if (pending === undefined) {
      pending = this.load(origin);
      this.cache.set(origin, pending);
      void pending.then((icon) => {
        if (icon === null) setTimeout(() => this.cache.delete(origin), RETRY_FAILED_AFTER_MS);
      });
    }
    return pending;
  }

  private async load(origin: string): Promise<string | null> {
    for (const path of CANDIDATE_PATHS) {
      const icon = await fetchIcon(`${origin}${path}`);
      if (icon !== null) return icon;
    }
    this.log.info("site_icon_not_found", { origin });
    return null;
  }
}

async function fetchIcon(url: string): Promise<string | null> {
  try {
    const response = await net.fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
    if (!response.ok) return null;
    if (Number(response.headers.get("content-length") ?? 0) > MAX_ICON_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_ICON_BYTES) return null;
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) return null;
    return image.resize({ width: ICON_SIZE, height: ICON_SIZE, quality: "best" }).toDataURL();
  } catch {
    return null; // offline, timeout, blocked, not an image...
  }
}

function httpOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}
