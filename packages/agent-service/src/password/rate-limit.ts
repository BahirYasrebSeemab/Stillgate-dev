import { PASSWORD_FREE_ATTEMPTS, PASSWORD_LOCKOUT_BASE_SEC, PASSWORD_LOCKOUT_MAX_SEC } from "@stillgate/shared";

// Restore-password rate limit (pure; the caller passes the time in).
// 5 wrong tries -> locked for 60 s; each further lockout doubles: 120 s, 240 s ... max 15 min.
// A correct password resets everything.

export type RateLimit = {
  readonly failures: number; // wrong tries since the last lockout
  readonly lockouts: number; // how many lockouts so far
  readonly lockedUntilMs: number;
};

export const FRESH_LIMIT: RateLimit = { failures: 0, lockouts: 0, lockedUntilMs: 0 };

// null = allowed now; a number = seconds to wait
export function retryAfterSec(limit: RateLimit, nowMs: number): number | null {
  return nowMs < limit.lockedUntilMs ? Math.ceil((limit.lockedUntilMs - nowMs) / 1000) : null;
}

export function recordFailure(limit: RateLimit, nowMs: number): RateLimit {
  const failures = limit.failures + 1;
  if (failures < PASSWORD_FREE_ATTEMPTS) return { ...limit, failures };
  const lockSec = Math.min(PASSWORD_LOCKOUT_BASE_SEC * 2 ** limit.lockouts, PASSWORD_LOCKOUT_MAX_SEC);
  return { failures: 0, lockouts: limit.lockouts + 1, lockedUntilMs: nowMs + lockSec * 1000 };
}
