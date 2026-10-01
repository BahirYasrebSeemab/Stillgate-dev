// Detects the maintenance hotkey Space + B + Y + S. Pure logic (no DOM), so it is unit-tested.
//
// Two ways to trigger it, because cheap keyboards often can't register 4 keys at once ("ghosting"):
//   "chord"    = all four held down at the same time
//   "sequence" = the four pressed one after another, in order, within 3 seconds
//   "either"   = both accepted (default)
// Keys are matched by KeyboardEvent.code = the PHYSICAL key, so it works the same
// on English, Russian and Tajik keyboard layouts.

export type HotkeyMode = "chord" | "sequence" | "either";

export const HOTKEY_CODES = ["Space", "KeyB", "KeyY", "KeyS"] as const;
export const SEQUENCE_WINDOW_MS = 3000;

export class HotkeyDetector {
  private readonly held = new Set<string>();
  private progress = 0; // how many keys of the sequence were pressed in order
  private startedAt = 0;

  constructor(
    private readonly mode: HotkeyMode = "either",
    private readonly windowMs: number = SEQUENCE_WINDOW_MS,
  ) {}

  // Returns true at the moment the hotkey is completed
  keyDown(code: string, nowMs: number, repeat = false): boolean {
    if (repeat) return false; // a held key repeats; only the first press counts
    this.held.add(code);
    const chord = this.mode !== "sequence" && HOTKEY_CODES.every((key) => this.held.has(key));
    const sequence = this.mode !== "chord" && this.advanceSequence(code, nowMs);
    if (chord || sequence) {
      this.reset();
      return true;
    }
    return false;
  }

  keyUp(code: string): void {
    this.held.delete(code);
  }

  // The window lost focus: forget held keys (we would never see their keyup)
  clear(): void {
    this.held.clear();
    this.reset();
  }

  private advanceSequence(code: string, nowMs: number): boolean {
    if (this.progress > 0 && nowMs - this.startedAt > this.windowMs) this.progress = 0;
    if (code === HOTKEY_CODES[this.progress]) {
      if (this.progress === 0) this.startedAt = nowMs;
      this.progress += 1;
    } else {
      // A wrong key restarts the sequence (and may itself be its first key)
      this.progress = code === HOTKEY_CODES[0] ? 1 : 0;
      this.startedAt = nowMs;
    }
    return this.progress === HOTKEY_CODES.length;
  }

  private reset(): void {
    this.progress = 0;
  }
}
