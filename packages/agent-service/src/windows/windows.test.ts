import { describe, expect, it } from "bun:test";
import { Policy } from "@stillgate/shared";
import { silentLogger } from "@stillgate/shared/node";
import { FakeExec, KIOSK } from "../test-helpers/fakes";
import { createExec } from "./exec";
import { Lockdown } from "./lockdown";
import { Registry, parseRegValue } from "./registry";
import { switchShell } from "./shell-switch";

describe("createExec", () => {
  it("only logs mutating commands in dry-run", async () => {
    const exec = createExec({ dryRun: () => true, log: silentLogger, platform: "win32" });
    expect(await exec.run("shutdown", ["/r", "/t", "0"], { mutates: true })).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  it("refuses to run Windows tools on other systems", async () => {
    const exec = createExec({ dryRun: () => false, log: silentLogger, platform: "linux" });
    expect((await exec.run("reg", ["query", "HKLM"], { mutates: false })).code).toBe(-1);
  });
});

describe("Registry", () => {
  it("builds reg.exe argument arrays", async () => {
    const exec = new FakeExec();
    const registry = new Registry(exec);
    await registry.setString("HKU\\S\\Key", "Shell", "C:\\Program Files\\x.exe");
    await registry.setDword("HKLM\\K", "Value", 2);
    await registry.deleteValue("HKLM\\K", "Value");
    expect(exec.calls.map((call) => call.args)).toEqual([
      ["add", "HKU\\S\\Key", "/v", "Shell", "/t", "REG_SZ", "/d", "C:\\Program Files\\x.exe", "/f"],
      ["add", "HKLM\\K", "/v", "Value", "/t", "REG_DWORD", "/d", "2", "/f"],
      ["delete", "HKLM\\K", "/v", "Value", "/f"],
    ]);
    expect(exec.calls.every((call) => call.options.mutates)).toBe(true);
  });

  it("parses reg query output, including spaces in the data", () => {
    const output = "\r\nHKEY_USERS\\S\\Winlogon\r\n    Shell    REG_SZ    C:\\Program Files\\Asd\\kiosk-shell.exe\r\n\r\n";
    expect(parseRegValue(output, "Shell")).toBe("C:\\Program Files\\Asd\\kiosk-shell.exe");
    expect(parseRegValue(output, "Other")).toBeNull();
  });
});

describe("switchShell", () => {
  const winlogon = `HKU\\${KIOSK.sid}\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon`;

  it("succeeds only when the read-back matches", async () => {
    const exec = new FakeExec(({ args }) =>
      args[0] === "query" && args[2] === "/v"
        ? { code: 0, stdout: `    Shell    REG_SZ    explorer.exe\r\n`, stderr: "" }
        : { code: 0, stdout: "", stderr: "" },
    );
    expect(await switchShell(new Registry(exec), KIOSK, "explorer", silentLogger, false)).toBe(true);
    expect(exec.calls.some((call) => call.args[1] === winlogon && call.args[0] === "add")).toBe(true);
  });

  it("fails when the read-back differs", async () => {
    const exec = new FakeExec(({ args }) =>
      args[0] === "query" && args[2] === "/v"
        ? { code: 0, stdout: `    Shell    REG_SZ    something-else.exe\r\n`, stderr: "" }
        : { code: 0, stdout: "", stderr: "" },
    );
    expect(await switchShell(new Registry(exec), KIOSK, "explorer", silentLogger, false)).toBe(false);
  });
});

describe("Lockdown", () => {
  it("writes the Edge lists as numbered values and the hardening dwords", async () => {
    const exec = new FakeExec();
    const sites = Policy.parse({ version: 1, apps: [], sites: [{ id: "a", name: "A", pattern: "a.org" }] }).sites;
    await new Lockdown(new Registry(exec), silentLogger).apply(KIOSK, sites, true);
    const adds = exec.calls.filter((call) => call.args[0] === "add").map((call) => call.args.slice(1, 4));
    expect(adds).toContainEqual(["HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge\\URLBlocklist", "/v", "1"]);
    expect(adds).toContainEqual(["HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge\\URLAllowlist", "/v", "1"]);
    expect(adds).toContainEqual(["HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge", "/v", "InPrivateModeAvailability"]);
    expect(adds.some((a) => a[0]?.startsWith(`HKU\\${KIOSK.sid}`) && a[2] === "NoLogoff")).toBe(true);
  });
});
