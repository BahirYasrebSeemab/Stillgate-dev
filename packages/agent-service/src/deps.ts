import { uptime } from "node:os";

// Things the agent needs from the outside world, as interfaces,
// so tests can pass fakes (like FastAPI's Depends(), but by hand).

export interface Clock {
  // Monotonic milliseconds: only moves forward, unaffected by changing the PC's clock
  monoMs(): number;
  // Wall-clock milliseconds since 1970 (Date.now())
  wallMs(): number;
  // Wall-clock estimate of when the PC booted; used to detect reboots
  bootWallMs(): number;
}

// UNTESTED(windows): process.hrtime is expected to be system-wide monotonic since boot
// (QueryPerformanceCounter), so deadlines survive a service restart within one boot.
export const systemClock: Clock = {
  monoMs: () => Number(process.hrtime.bigint() / 1_000_000n),
  wallMs: () => Date.now(),
  bootWallMs: () => Date.now() - Math.round(uptime() * 1000),
};
