import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { MachineId } from "../ids";
import { readJson, writeJsonAtomic } from "./atomic-json";
import { authMac, generatePairingCode, hashPassword, randomHex, safeEqualHex, verifyPassword } from "./crypto";
import { redact } from "./log";
import { isPairingCode } from "../pairing";

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const record = await hashPassword("correct horse battery", 1);
    expect(await verifyPassword("correct horse battery", record)).toBe(true);
    expect(await verifyPassword("correct horse batterY", record)).toBe(false);
    expect(JSON.stringify(record)).not.toContain("correct horse");
  });

  it("uses a new salt every time", async () => {
    const [a, b] = await Promise.all([hashPassword("same password", 1), hashPassword("same password", 1)]);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it("fails safely on a tampered record", async () => {
    const record = await hashPassword("some password", 1);
    expect(await verifyPassword("some password", { ...record, hash: Buffer.from("x").toString("base64") })).toBe(false);
  });
});

describe("challenge-response MAC", () => {
  const secret = randomHex(32);
  const nonce = randomHex(32);
  const m1 = MachineId.parse("3f2b8c1e-5d4a-4b6c-9e8f-0a1b2c3d4e5f");
  const m2 = MachineId.parse("4f2b8c1e-5d4a-4b6c-9e8f-0a1b2c3d4e5f");

  it("is deterministic and bound to the machine id", () => {
    expect(authMac(secret, nonce, m1)).toBe(authMac(secret, nonce, m1));
    expect(authMac(secret, nonce, m1)).not.toBe(authMac(secret, nonce, m2));
    expect(authMac(secret, nonce, m1)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("safeEqualHex handles different lengths and non-hex", () => {
    expect(safeEqualHex("abcd", "abcd")).toBe(true);
    expect(safeEqualHex("abcd", "abce")).toBe(false);
    expect(safeEqualHex("abcd", "abcdef")).toBe(false);
    expect(safeEqualHex("zz", "zz")).toBe(false);
  });

  it("generates valid pairing codes", () => {
    for (let i = 0; i < 20; i++) expect(isPairingCode(generatePairingCode())).toBe(true);
  });
});

describe("atomic JSON files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "stillgate-test-"));
  const Schema = z.strictObject({ schemaVersion: z.literal(1), count: z.int() });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("writes and reads back", async () => {
    const file = join(dir, "nested", "data.json");
    await writeJsonAtomic(file, { schemaVersion: 1, count: 3 });
    expect(await readJson(file, Schema)).toEqual({ ok: true, value: { schemaVersion: 1, count: 3 } });
    expect(await readFile(file, "utf8")).toEndWith("\n");
  });

  it("reports missing and corrupt files", async () => {
    expect(await readJson(join(dir, "nope.json"), Schema)).toEqual({ ok: false, error: { kind: "missing" } });
    const bad = join(dir, "bad.json");
    await writeFile(bad, "{ half");
    const result = await readJson(bad, Schema);
    expect(result.ok === false && result.error.kind).toBe("corrupt");
  });
});

describe("log redaction", () => {
  it("hides secret-looking fields, also nested ones", () => {
    const out = redact({ user: "kiosk", password: "x", nested: { secretKey: "y", ok: 1 } }, 0);
    expect(out).toEqual({ user: "kiosk", password: "[redacted]", nested: { secretKey: "[redacted]", ok: 1 } });
  });
});
