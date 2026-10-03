import { describe, expect, it } from "bun:test";
import { hasDebugSwitch } from "./debug-switches";

describe("hasDebugSwitch", () => {
  it("spots debugger switches in any form", () => {
    expect(hasDebugSwitch(["app.exe", "--remote-debugging-port=9222"])).toBe(true);
    expect(hasDebugSwitch(["app.exe", "--INSPECT"])).toBe(true);
    expect(hasDebugSwitch(["app.exe", "--inspect-brk=5858"])).toBe(true);
    expect(hasDebugSwitch(["app.exe", "-remote-debugging-pipe"])).toBe(true);
  });

  it("allows a normal start", () => {
    expect(hasDebugSwitch(["C:\\Program Files\\AsdLabLock\\kiosk-shell\\kiosk-shell.exe"])).toBe(false);
    expect(hasDebugSwitch(["app.exe", "--allow-file-access"])).toBe(false);
  });
});
