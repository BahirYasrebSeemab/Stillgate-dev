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
