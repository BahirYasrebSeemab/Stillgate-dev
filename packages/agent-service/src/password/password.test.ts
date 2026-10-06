import { describe, expect, it } from "bun:test";
import { hashPassword, silentLogger } from "@stillgate/shared/node";
import { FRESH_LIMIT, recordFailure, retryAfterSec } from "./rate-limit";
import { RestoreGuard } from "./restore";

describe("rate limit", () => {
  it("allows 4 failures, locks on the 5th, and doubles each lockout up to 15 minutes", () => {
    let limit = FRESH_LIMIT;
    for (let i = 0; i < 4; i++) limit = recordFailure(limit, 0);
    expect(retryAfterSec(limit, 0)).toBeNull();
    limit = recordFailure(limit, 0);
    expect(retryAfterSec(limit, 0)).toBe(60);

    let now = 60_000;
    const lockouts: number[] = [];
    for (let round = 0; round < 6; round++) {
      for (let i = 0; i < 5; i++) limit = recordFailure(limit, now);
      const wait = retryAfterSec(limit, now) ?? 0;
      lockouts.push(wait);
      now += wait * 1000;
    }
    expect(lockouts).toEqual([120, 240, 480, 900, 900, 900]);
  });
});

describe("RestoreGuard", async () => {
  const record = await hashPassword("restore password 1", 1);

  const makeGuard = (stored = record) => {
    const entered: number[] = [];
    let now = 0;
    const guard = new RestoreGuard({
      log: silentLogger,
      nowMs: () => now,
      passwordRecord: () => stored,
      enterMaintenance: async (sec) => {
        entered.push(sec);
      },
      reportEvent: () => undefined,
    });
    return { guard, entered, setNow: (ms: number) => (now = ms) };
  };

  it("enters maintenance on the right password", async () => {
    const { guard, entered } = makeGuard();
    expect((await guard.attempt("restore password 1")).ok).toBe(true);
    expect(entered).toEqual([1800]);
  });

  it("locks out after 5 wrong tries, even for the right password", async () => {
    const { guard, entered } = makeGuard();
    for (let i = 0; i < 4; i++) expect(await guard.attempt("wrong")).toEqual({ ok: false, error: { code: "wrong_password" } });
    expect(await guard.attempt("wrong")).toEqual({ ok: false, error: { code: "locked_out", retryAfterSec: 60 } });
    expect(await guard.attempt("restore password 1")).toEqual({ ok: false, error: { code: "locked_out", retryAfterSec: 60 } });
    expect(entered).toEqual([]);
  });

  it("refuses when no password was ever set", async () => {
    const guard = new RestoreGuard({
      log: silentLogger,
      nowMs: () => 0,
      passwordRecord: () => undefined,
      enterMaintenance: async () => undefined,
      reportEvent: () => undefined,
    });
    expect(await guard.attempt("anything")).toEqual({ ok: false, error: { code: "no_password_set" } });
  });
});
