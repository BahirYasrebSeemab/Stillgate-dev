import { RECONNECT_JITTER, RECONNECT_MAX_MS, RECONNECT_MIN_MS } from "@asd/shared";

// Wait before reconnect attempt n: 1 s, 2 s, 4 s ... capped at 60 s, +/-20 % random "jitter"
// so 4 PCs that lost the server at the same moment don't all reconnect at the same moment.
export function reconnectDelayMs(attempt: number, random: number = Math.random()): number {
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt);
  const jitter = 1 + (random * 2 - 1) * RECONNECT_JITTER;
  return Math.round(base * jitter);
}
