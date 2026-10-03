// Finds a website's icon addresses in its homepage HTML, the way browsers do:
//   <link rel="apple-touch-icon" href="...">   (big, sharp: preferred)
//   <link rel="icon" href="..."> / rel="shortcut icon"
// Pure function (no network), so it is unit-tested. SVG icons are skipped
// (Electron's image decoder can't read SVG); data: URLs are skipped too.

const LINK_TAG = /<link\b[^>]*>/gi;
const MAX_CANDIDATES = 4;

export function findIconUrls(html: string, pageUrl: string): string[] {
  const found: { url: string; priority: number }[] = [];
  for (const tag of html.match(LINK_TAG) ?? []) {
    const rel = attribute(tag, "rel")?.toLowerCase() ?? "";
    const href = attribute(tag, "href");
    if (href === null || href.startsWith("data:") || /\.svg(\?|#|$)/i.test(href)) continue;
    const priority = rel.includes("apple-touch-icon") ? 0 : /(^|\s)icon(\s|$)/.test(rel) ? 1 : -1;
    if (priority < 0) continue;
    const url = resolve(href, pageUrl);
    if (url !== null) found.push({ url, priority });
  }
  return [...new Set(found.sort((a, b) => a.priority - b.priority).map((f) => f.url))].slice(0, MAX_CANDIDATES);
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value === undefined ? null : value.trim();
}

function resolve(href: string, pageUrl: string): string | null {
  try {
    const url = new URL(href, pageUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

// Security: an allowed site's HTML decides where we download its icon from. Without a check,
// a page could point that at addresses INSIDE the ASD network (routers, the manager PC...)
// and make the kiosk send requests there. So an icon may only come from a public address,
// or from the allowed site's own host (an intranet site may still show its own icon).
export function isAllowedIconUrl(url: string, siteHost: string): boolean {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    host = parsed.hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === siteHost.toLowerCase()) return true;
  if (host.startsWith("[") || host.includes(":")) return false; // IPv6 literal: not needed, refuse
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || !host.includes(".")) return false;
  const octets = host.split(".").map(Number);
  if (octets.length === 4 && octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    return !isPrivateIPv4(octets[0] ?? 0, octets[1] ?? 0);
  }
  return true;
}

// Loopback, private LAN, link-local and carrier-NAT ranges, decided by the first two numbers
function isPrivateIPv4(a: number, b: number): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}
