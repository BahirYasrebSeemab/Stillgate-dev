import { PAIRING_CODE_ALPHABET, PAIRING_CODE_LENGTH } from "./constants";
import { err, ok, type Result } from "./result";
import { isIPv4 } from "./site-pattern";

// The pairing string the manager shows and the agent's `pair` command accepts:
//   asd1:<ipv4>:<port>:<sha256 cert fingerprint, 64 hex>:<one-time code>
// IPv4 only in v1, because IPv6 addresses contain ':' themselves.

export const PAIRING_PREFIX = "asd1";
const FINGERPRINT = /^[0-9a-f]{64}$/;
const MAX_PORT = 65535;

export type PairingInfo = {
  readonly ip: string;
  readonly port: number;
  readonly fingerprint: string;
  readonly code: string;
};

export function encodePairing(info: PairingInfo): string {
  return [PAIRING_PREFIX, info.ip, info.port, info.fingerprint, info.code].join(":");
}

export function decodePairing(input: string): Result<PairingInfo, string> {
  const parts = input.trim().split(":");
  if (parts.length !== 5) return err("pairing string must have 5 parts separated by ':'");
  const [prefix, ip, portText, fingerprint, code] = parts as [string, string, string, string, string];

  if (prefix !== PAIRING_PREFIX) return err(`pairing string must start with "${PAIRING_PREFIX}:"`);
  if (!isIPv4(ip)) return err("server address must be an IPv4 address like 192.168.1.10");
  const port = Number(portText);
  if (!/^\d{1,5}$/.test(portText) || port < 1 || port > MAX_PORT) return err("invalid port");
  if (!FINGERPRINT.test(fingerprint)) return err("certificate fingerprint must be 64 lowercase hex characters");
  if (!isPairingCode(code)) return err("invalid pairing code");

  return ok({ ip, port, fingerprint, code });
}

export function isPairingCode(code: string): boolean {
  return code.length === PAIRING_CODE_LENGTH && [...code].every((ch) => PAIRING_CODE_ALPHABET.includes(ch));
}
