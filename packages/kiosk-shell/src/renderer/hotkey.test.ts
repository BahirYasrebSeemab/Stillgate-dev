import { describe, expect, it } from "bun:test";
import { HotkeyDetector } from "./hotkey";

const press = (detector: HotkeyDetector, codes: string[], at = 0, step = 100) =>
  codes.map((code, i) => detector.keyDown(code, at + i * step));

describe("HotkeyDetector", () => {
  it("triggers when all four keys are held together", () => {
    const detector = new HotkeyDetector("chord");
    expect(press(detector, ["KeyS", "KeyY", "Space", "KeyB"])).toEqual([false, false, false, true]);
  });

  it("does not trigger a chord if a key was released", () => {
    const detector = new HotkeyDetector("chord");
    press(detector, ["Space", "KeyB", "KeyY"]);
    detector.keyUp("KeyB");
    expect(detector.keyDown("KeyS", 500)).toBe(false);
  });

  it("triggers on the sequence in order within 3 seconds", () => {
    const detector = new HotkeyDetector("sequence");
    const results = ["Space", "KeyB", "KeyY", "KeyS"].map((code) => {
      const fired = detector.keyDown(code, 0);
      detector.keyUp(code);
      return fired;
    });
    expect(results).toEqual([false, false, false, true]);
  });

  it("does not trigger a sequence that is too slow or out of order", () => {
    const slow = new HotkeyDetector("sequence");
    expect(press(slow, ["Space", "KeyB", "KeyY", "KeyS"], 0, 1100)).toEqual([false, false, false, false]);
    const wrong = new HotkeyDetector("sequence");
    expect(press(wrong, ["Space", "KeyY", "KeyB", "KeyS"])).toEqual([false, false, false, false]);
  });

  it("recovers when a wrong key is followed by the right sequence", () => {
    const detector = new HotkeyDetector("sequence");
    expect(press(detector, ["KeyA", "Space", "KeyB", "KeyY", "KeyS"]).at(-1)).toBe(true);
  });

  it("ignores auto-repeat and works with either mode", () => {
    const detector = new HotkeyDetector("either");
    expect(detector.keyDown("Space", 0)).toBe(false);
    expect(detector.keyDown("Space", 50, true)).toBe(false);
    expect(press(detector, ["KeyB", "KeyY", "KeyS"], 100).at(-1)).toBe(true);
  });

  it("chord-only mode ignores a released sequence", () => {
    const detector = new HotkeyDetector("chord");
    for (const code of ["Space", "KeyB", "KeyY"]) {
      detector.keyDown(code, 0);
      detector.keyUp(code);
    }
    expect(detector.keyDown("KeyS", 0)).toBe(false);
  });
});
