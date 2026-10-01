import { MAX_SITE_PATTERN_CHARS } from "./constants";
import { err, ok, type Result } from "./result";

// Validates one allowed-site pattern in the Edge/Chrome URL filter format:
//   [scheme://][.]host[:port][/path]
// and returns it normalized (lowercase scheme and host).
// Deliberately stricter than Edge: no wildcards at all, a real host is required.

const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const PATH = /^\/[\x21-\x7e]*$/;
const MAX_PORT = 65535;

export function validateSitePattern(input: string): Result<string, string> {
  const raw = input.trim();
  if (raw === "") return err("pattern is empty");
  if (raw.length > MAX_SITE_PATTERN_CHARS) return err("pattern is too long");
  if (/[\s*]/.test(raw)) return err("wildcards (*) and spaces are not allowed");

  let rest = raw;
  let scheme = "";
  const schemeMatch = SCHEME.exec(rest);
  if (schemeMatch) {
    const name = (schemeMatch[1] ?? "").toLowerCase();
    if (name !== "http" && name !== "https") return err("only http:// and https:// are allowed");
    scheme = `${name}://`;
    rest = rest.slice(schemeMatch[0].length);
  }

  const exactPrefix = rest.startsWith(".") ? "." : "";
  rest = rest.slice(exactPrefix.length);

  const slash = rest.indexOf("/");
  const hostPort = slash === -1 ? rest : rest.slice(0, slash);
  const path = slash === -1 ? "" : rest.slice(slash);
  if (path !== "" && !PATH.test(path)) return err("path contains invalid characters");

  const [host = "", port, ...extra] = hostPort.split(":");
  if (extra.length > 0) return err("invalid host:port");
  const hostResult = checkHost(host.toLowerCase());
  if (!hostResult.ok) return hostResult;

  let portPart = "";
  if (port !== undefined) {
    const portNumber = Number(port);
    if (!/^\d{1,5}$/.test(port) || portNumber < 1 || portNumber > MAX_PORT) return err("invalid port");
    portPart = `:${portNumber}`;
  }

  return ok(`${scheme}${exactPrefix}${hostResult.value}${portPart}${path}`);
}

function checkHost(host: string): Result<string, string> {
  if (host === "") return err("host is missing");
  if (isIPv4(host)) return ok(host);
  const labels = host.split(".");
  if (labels.length < 2) return err("host must be a full domain like example.org");
  if (!labels.every((label) => LABEL.test(label))) return err("host contains an invalid name part");
  if (/^\d+$/.test(labels[labels.length - 1] ?? "")) return err("host is not a valid domain or IPv4 address");
  return ok(host);
}

export function isIPv4(text: string): boolean {
  const parts = text.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)
  );
}
