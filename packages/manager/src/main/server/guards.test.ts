import { describe, expect, it } from "bun:test";
import { isPairingCode } from "@stillgate/shared";
import { AuthLimiter, PairingCodes } from "./guards";

describe("PairingCodes", () => {
  it("creates valid codes that work exactly once", () => {
    const codes = new PairingCodes();
    const { code, expiresAt } = codes.create(0);
    expect(isPairingCode(code)).toBe(true);
    expect(expiresAt).toBe(10 * 60_000);
    expect(codes.consume(code, 1000)).toBe(true);
    expect(codes.consume(code, 1000)).toBe(false);
  });

  it("expires codes after 10 minutes", () => {
    const codes = new PairingCodes();
    const { code } = codes.create(0);
    expect(codes.consume(code, 10 * 60_000)).toBe(false);
  });
});

describe("AuthLimiter", () => {
  it("blocks an address after 10 failures in 5 minutes, for 15 minutes", () => {
    const limiter = new AuthLimiter();
    for (let i = 0; i < 9; i++) limiter.recordFailure("10.0.0.5", i * 1000);
    expect(limiter.isBlocked("10.0.0.5", 9000)).toBe(false);
    limiter.recordFailure("10.0.0.5", 9000);
    expect(limiter.isBlocked("10.0.0.5", 9001)).toBe(true);
    expect(limiter.isBlocked("10.0.0.6", 9001)).toBe(false);
    expect(limiter.isBlocked("10.0.0.5", 9000 + 15 * 60_000)).toBe(false);
  });

  it("forgets failures older than the window", () => {
    const limiter = new AuthLimiter();
    for (let i = 0; i < 9; i++) limiter.recordFailure("10.0.0.7", 0);
    limiter.recordFailure("10.0.0.7", 5 * 60_000 + 1);
    expect(limiter.isBlocked("10.0.0.7", 5 * 60_000 + 2)).toBe(false);
  });
});
