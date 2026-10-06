import { AUTH_BLOCK_MS, AUTH_FAIL_LIMIT, AUTH_FAIL_WINDOW_MS, PAIRING_CODE_TTL_MS } from "@stillgate/shared";
import { generatePairingCode } from "@stillgate/shared/node";

// Limits failed logins/pairings per IP address:
// 10 failures within 5 minutes -> that address is ignored for 15 minutes.
export class AuthLimiter {
  private readonly failures = new Map<string, number[]>();
  private readonly blockedUntil = new Map<string, number>();

  isBlocked(ip: string, nowMs: number): boolean {
    return (this.blockedUntil.get(ip) ?? 0) > nowMs;
  }

  recordFailure(ip: string, nowMs: number): void {
    const recent = (this.failures.get(ip) ?? []).filter((at) => nowMs - at < AUTH_FAIL_WINDOW_MS);
    recent.push(nowMs);
    if (recent.length >= AUTH_FAIL_LIMIT) {
      this.blockedUntil.set(ip, nowMs + AUTH_BLOCK_MS);
      this.failures.delete(ip);
    } else {
      this.failures.set(ip, recent);
    }
  }
}

// One-time pairing codes: valid for 10 minutes, usable once.
export class PairingCodes {
  private readonly active = new Map<string, number>();

  create(nowMs: number): { code: string; expiresAt: number } {
    this.prune(nowMs);
    const code = generatePairingCode();
    const expiresAt = nowMs + PAIRING_CODE_TTL_MS;
    this.active.set(code, expiresAt);
    return { code, expiresAt };
  }

  // True only once per valid code
  consume(code: string, nowMs: number): boolean {
    this.prune(nowMs);
    return this.active.delete(code);
  }

  private prune(nowMs: number): void {
    for (const [code, expiresAt] of this.active) if (expiresAt <= nowMs) this.active.delete(code);
  }
}
