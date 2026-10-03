import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { nativeImage, net } from "electron";
import { writeJsonAtomic, type Logger } from "@asd/shared/node";
import { bestImageInIco } from "./ico";
import { findIconUrls, isAllowedIconUrl } from "./icon-links";

// Fetches the icon of an allowed website for its launcher tile.
// Safety rules:
//   - only called for sites the agent currently allows (see ipc.ts), only http(s)
//   - icon addresses taken from the page must be public (no requests into the local network)
//   - time limit, at most 256 KB per icon, the kiosk session has no cookies of ours
//   - the bytes are decoded and RE-ENCODED by Electron (nativeImage -> PNG data URL),
//     so the page only ever gets a clean image, and its CSP still allows no network access
// How it finds the icon (tested on real sites; many have nothing at /favicon.ico):
//   1. load the homepage (max 512 KB) and read its <link rel="apple-touch-icon" / "icon"> tags
//   2. fall back to /favicon.ico
// Found icons are kept in a small cache file, so each one is downloaded only once.
// Lessons from testing on Windows (Electron 44):
//   - passing ANY abort signal to net.fetch makes it fail at once -> the time limit is a race
//   - the ASD network can be slow (homepages took 5-10 s) -> generous time limit + cache
//   - nativeImage can't read .ico -> ico.ts extracts the PNG or decodes the bitmap inside

const TIMEOUT_MS = 20_000;
const MAX_ICON_BYTES = 256 * 1024;
const MAX_PAGE_BYTES = 512 * 1024;
const ICON_SIZE = 64;
const RETRY_FAILED_AFTER_MS = 5 * 60_000; // e.g. the PC was offline at first
const CACHE_FILE = "site-icons.json";
const MAX_CACHED_ICON_CHARS = 200_000;

export class SiteIcons {
  private readonly pending = new Map<string, Promise<string | null>>();
  private saved: Record<string, string> = {};
  private readonly ready: Promise<void>;

  constructor(
    private readonly log: Logger,
    private readonly cacheDir: string,
  ) {
    this.ready = this.loadCache();
  }

  async get(url: string): Promise<string | null> {
    const origin = httpOrigin(url);
    if (origin === null) return null;
    await this.ready;
    const cached = this.saved[origin];
    if (cached !== undefined) return cached;
    let pending = this.pending.get(origin);
    if (pending === undefined) {
      pending = this.load(url, origin);
      this.pending.set(origin, pending);
      void pending.then((icon) => this.remember(origin, icon));
    }
    return pending;
  }

  private async load(url: string, origin: string): Promise<string | null> {
    const page = await fetchPage(url, this.log);
    const candidates = [
      ...(page === null ? [] : findIconUrls(page.html, page.finalUrl)),
      ...(page === null ? [] : [`${new URL(page.finalUrl).origin}/favicon.ico`]),
      `${origin}/favicon.ico`,
    ];
    const siteHost = new URL(origin).hostname;
    const allowed = [...new Set(candidates)].filter((candidate) => isAllowedIconUrl(candidate, siteHost));
    this.log.debug("site_icon_candidates", { origin, pageLoaded: page !== null, candidates: allowed });
    for (const candidate of allowed) {
      const icon = await fetchIcon(candidate, this.log);
      if (icon !== null) return icon;
    }
    this.log.info("site_icon_not_found", { origin });
    return null;
  }

  private remember(origin: string, icon: string | null): void {
    if (icon === null) {
      setTimeout(() => this.pending.delete(origin), RETRY_FAILED_AFTER_MS);
      return;
    }
    this.saved = { ...this.saved, [origin]: icon };
    this.pending.delete(origin);
    writeJsonAtomic(join(this.cacheDir, CACHE_FILE), this.saved).catch((error: unknown) =>
      this.log.warn("site_icon_cache_write_failed", { error }),
    );
  }

  private async loadCache(): Promise<void> {
    try {
      const data: unknown = JSON.parse(await readFile(join(this.cacheDir, CACHE_FILE), "utf8"));
      if (typeof data !== "object" || data === null) return;
      // Keep only well-formed PNG data URLs (the file could have been edited by someone)
      this.saved = Object.fromEntries(
        Object.entries(data).filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === "string" &&
            entry[1].startsWith("data:image/png;base64,") &&
            entry[1].length < MAX_CACHED_ICON_CHARS,
        ),
      );
    } catch {
      // no cache yet
    }
  }
}

function fetchWithTimeout(url: string): Promise<Response> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS);
  });
  return Promise.race([net.fetch(url, { redirect: "follow" }), timeout]).finally(() => clearTimeout(timer));
}

async function fetchPage(url: string, log: Logger): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const response = await fetchWithTimeout(url);
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.includes("html")) {
      log.debug("site_page_unusable", { url, status: response.status, type });
      return null;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return { html: bytes.subarray(0, MAX_PAGE_BYTES).toString("utf8"), finalUrl: response.url || url };
  } catch (error) {
    log.debug("site_page_failed", { url, error });
    return null;
  }
}

async function fetchIcon(url: string, log: Logger): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      log.debug("site_icon_http_error", { url, status: response.status });
      return null;
    }
    if (Number(response.headers.get("content-length") ?? 0) > MAX_ICON_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_ICON_BYTES) return null;
    let image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) {
      // .ico file: use the PNG inside, or the decoded bitmap pixels
      const ico = bestImageInIco(bytes);
      if (ico?.kind === "png") image = nativeImage.createFromBuffer(ico.png);
      if (ico?.kind === "bgra") image = nativeImage.createFromBitmap(ico.pixels, { width: ico.width, height: ico.height });
    }
    if (image.isEmpty()) {
      log.debug("site_icon_undecodable", { url, bytes: bytes.length });
      return null;
    }
    return image.resize({ width: ICON_SIZE, height: ICON_SIZE, quality: "best" }).toDataURL();
  } catch (error) {
    log.debug("site_icon_failed", { url, error }); // offline, timeout, blocked...
    return null;
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
