import { describe, expect, it } from "bun:test";
import { Policy } from "@stillgate/shared";
import { silentLogger } from "@stillgate/shared/node";
import { decideKills, type DecideInput } from "./decide";
import { parseProcessList, userName, type ProcessInfo } from "./processes";

const policy = Policy.parse({
  version: 1,
  apps: [{ id: "paint", name: "Paint", exePath: "C:\\Program Files\\Paint\\paint.exe" }],
  sites: [{ id: "khan", name: "Khan", pattern: "khanacademy.org" }],
});

let nextPid = 100;
const proc = (path: string | null): ProcessInfo => ({ pid: nextPid++, name: "x", path, user: "kiosk" });

const input = (state: DecideInput["state"], processes: ProcessInfo[]): DecideInput => ({
  processes,
  state,
  policy,
  kioskShellDir: "C:\\Program Files\\Stillgate\\kiosk-shell",
  windowsDir: "C:\\Windows",
});

const killed = (decisionInput: DecideInput) => decideKills(decisionInput).map((d) => d.reason);

describe("decideKills", () => {
  const shell = proc("C:\\Program Files\\Stillgate\\kiosk-shell\\kiosk-shell.exe");
  const helper = proc("C:\\Windows\\System32\\conhost.exe");
  const cmd = proc("C:\\Windows\\System32\\cmd.exe");
  const paint = proc("C:\\Program Files\\Paint\\paint.exe");
  const edge = proc("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe");
  const game = proc("C:\\Users\\kiosk\\Downloads\\game.exe");

  it("kills nothing in MAINTENANCE", () => {
    expect(decideKills(input("MAINTENANCE", [cmd, game]))).toEqual([]);
  });

  it("when LOCKED keeps only the shell and Windows helpers", () => {
    expect(killed(input("LOCKED", [shell, helper, paint, edge, game]))).toEqual(["locked", "locked", "locked"]);
  });

  it("when UNLOCKED allows policy apps and Edge (sites exist)", () => {
    expect(killed(input("UNLOCKED", [shell, helper, paint, edge, game]))).toEqual(["not_allowed"]);
  });

  it("always kills deny-listed Windows tools, even when unlocked", () => {
    const tricky = proc("C:\\Windows\\System32\\CMD.EXE. ");
    expect(killed(input("UNLOCKED", [cmd, tricky, proc("C:\\Windows\\explorer.exe")]))).toEqual([
      "deny_list",
      "deny_list",
      "deny_list",
    ]);
  });

  it("does not allow Edge when the policy has no sites", () => {
    const noSites = { ...input("UNLOCKED", [edge]), policy: { ...policy, sites: [] } };
    expect(killed(noSites)).toEqual(["not_allowed"]);
  });

  it("leaves processes with an unknown path alone", () => {
    expect(decideKills(input("LOCKED", [proc(null)]))).toEqual([]);
  });
});

describe("parseProcessList", () => {
  it("accepts process id 0 (System Idle Process, seen on real Windows)", () => {
    expect(parseProcessList('[{"pid":0,"name":"Idle","path":null,"user":null}]', silentLogger)).toHaveLength(1);
  });

  it("strips the computer name from owners and keeps non-English names", () => {
    expect(userName("DESKTOP-DIBHQC4\\Администратор")).toBe("Администратор");
    expect(userName("kiosk")).toBe("kiosk");
    expect(userName(null)).toBeNull();
  });

  it("parses PowerShell JSON and rejects garbage", () => {
    const json = JSON.stringify([{ pid: 4, name: "a.exe", path: null, user: null }]);
    expect(parseProcessList(json, silentLogger)).toEqual([{ pid: 4, name: "a.exe", path: null, user: null }]);
    expect(parseProcessList("", silentLogger)).toEqual([]);
    expect(parseProcessList("not json", silentLogger)).toBeNull();
    expect(parseProcessList('[{"pid":"x"}]', silentLogger)).toBeNull();
  });
});
