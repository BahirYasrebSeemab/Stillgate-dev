import { nativeImage, net } from "electron";
import type { Logger } from "@asd/shared/node";
import { findIconUrls } from "./icon-links";

// Fetches the icon of an allowed website for its launcher tile.
// Safety rules:
//   - only called for sites the agent currently allows (see ipc.ts), only http(s)
//   - 5 s timeout, at most 256 KB, no cookies of ours (the kiosk session has none)
//   - the bytes are decoded and RE-ENCODED by Electron (nativeImage -> PNG data URL),
//     so the page only ever gets a clean image, and its CSP still allows no network access
// How it finds the icon (tested on real sites: many have nothing at /favicon.ico):
//   1. load the homepage (max 512 KB) and read its <link rel="apple-touch-icon" / "icon"> tags
//   2. fall back to /favicon.ico on the final (after redirects) and the original address

const TIMEOUT_MS = 5000;
const MAX_ICON_BYTES = 256 * 1024;
const MAX_PAGE_BYTES = 512 * 1024;
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
      pending = this.load(url, origin);
      this.cache.set(origin, pending);
      void pending.then((icon) => {
        if (icon === null) setTimeout(() => this.cache.delete(origin), RETRY_FAILED_AFTER_MS);
      });
    }
    return pending;
  }

  private async load(url: string, origin: string): Promise<string | null> {
    const page = await fetchPage(url);
    const candidates = [
      ...(page === null ? [] : findIconUrls(page.html, page.finalUrl)),
      ...(page === null ? [] : [`${new URL(page.finalUrl).origin}/favicon.ico`]),
      `${origin}/favicon.ico`,
    ];
    for (const candidate of new Set(candidates)) {
      const icon = await fetchIcon(candidate);
      if (icon !== null) return icon;
    }
    this.log.info("site_icon_not_found", { origin });
    return null;
  }
}

// NOTE: AbortSignal.timeout() aborts at once inside Electron's main process (seen on Windows,
// Electron 44), so a plain timer + AbortController is used instead.
async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await net.fetch(url, { signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPage(url: string): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("html")) return null;
    if (Number(response.headers.get("content-length") ?? 0) > MAX_PAGE_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return { html: bytes.subarray(0, MAX_PAGE_BYTES).toString("utf8"), finalUrl: response.url || url };
  } catch {
    return null;
  }
}

async function fetchIcon(url: string): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(url);
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
