import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { PAIRING_CODE_ALPHABET, PAIRING_CODE_LENGTH } from "../constants";
import type { MachineId } from "../ids";
import type { PasswordRecord } from "../protocol";

// scrypt cost parameters. Stored inside every PasswordRecord so they can be raised later
// without breaking old hashes. N=2^15, r=8 needs 32 MiB, which is exactly Node's default
// memory cap, so maxmem must be raised or scrypt throws.
export const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1, keylen: 64 } as const;
const SALT_BYTES = 16;

export async function hashPassword(password: string, version: number): Promise<PasswordRecord> {
  const salt = randomBytes(SALT_BYTES);
  const { keylen, ...cost } = SCRYPT_PARAMS;
  const hash = await scryptAsync(password, salt, keylen, { ...cost, maxmem: scryptMemory(cost) });
  return {
    algo: "scrypt",
    salt: salt.toString("base64"),
    hash: hash.toString("base64"),
    params: { ...SCRYPT_PARAMS },
    version,
  };
}

// Recomputes the hash with the record's own salt and params and compares in constant time
export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  const { keylen, ...cost } = record.params;
  const expected = Buffer.from(record.hash, "base64");
  try {
    const actual = await scryptAsync(password, Buffer.from(record.salt, "base64"), keylen, {
      ...cost,
      maxmem: scryptMemory(cost),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Challenge-response proof: HMAC-SHA256(secret, nonce + machineId), hex.
// Proves the agent knows the secret without ever sending it.
export function authMac(secretHex: string, nonceHex: string, machineId: MachineId): string {
  return createHmac("sha256", Buffer.from(secretHex, "hex")).update(nonceHex).update(machineId).digest("hex");
}

// Constant-time comparison of two hex strings (false for different lengths or non-hex input)
export function safeEqualHex(a: string, b: string): boolean {
  const hex = /^(?:[0-9a-f]{2})*$/;
  if (a.length !== b.length || !hex.test(a) || !hex.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export function generatePairingCode(): string {
  let code = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)];
  }
  return code;
}

// SHA-256 of a certificate's DER bytes, as 64 lowercase hex characters
export function certFingerprint(der: Uint8Array): string {
  return createHash("sha256").update(der).digest("hex");
}

function scryptMemory(cost: { N: number; r: number; p: number }): number {
  // scrypt uses about 128 * N * r bytes; double it for headroom
  return 2 * 128 * cost.N * cost.r * cost.p;
}

function scryptAsync(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}
