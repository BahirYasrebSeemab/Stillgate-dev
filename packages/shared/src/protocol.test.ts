import { describe, expect, it } from "bun:test";
import { MAX_MESSAGE_BYTES } from "./constants";
import { parseAgentMessage, parseServerMessage } from "./protocol";
import { parseAgentToShell, parseShellRequest } from "./shell-protocol";

const MACHINE = "3f2b8c1e-5d4a-4b6c-9e8f-0a1b2c3d4e5f";
const HEX = "a".repeat(64);
const json = (value: unknown) => JSON.stringify(value);

describe("agent -> server messages", () => {
  it("accepts a valid hello", () => {
    const result = parseAgentMessage(json({ type: "hello", protocol: 1, machineId: MACHINE, agentVersion: "0.1.0" }));
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown message type", () => {
    expect(parseAgentMessage(json({ type: "become_admin" })).ok).toBe(false);
  });

  it("rejects extra keys", () => {
    expect(parseAgentMessage(json({ type: "heartbeat", extra: true })).ok).toBe(false);
  });

  it("rejects a bad machine id and a bad MAC", () => {
    expect(parseAgentMessage(json({ type: "hello", protocol: 1, machineId: "pc1", agentVersion: "0.1.0" })).ok).toBe(false);
    expect(parseAgentMessage(json({ type: "auth_response", mac: "ABC" })).ok).toBe(false);
  });

  it("rejects text that is not JSON", () => {
    const result = parseAgentMessage("hello there");
    expect(result).toEqual({ ok: false, error: "message is not valid JSON" });
  });

  it("rejects oversized messages before parsing them", () => {
    const huge = json({ type: "event", kind: "x", detail: "y".repeat(MAX_MESSAGE_BYTES), at: 0 });
    const result = parseAgentMessage(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("larger than");
  });
});

describe("server -> agent messages", () => {
  it("accepts unlock within limits and rejects outside them", () => {
    expect(parseServerMessage(json({ type: "unlock", durationSec: 3600 })).ok).toBe(true);
    expect(parseServerMessage(json({ type: "unlock", durationSec: 30 })).ok).toBe(false);
    expect(parseServerMessage(json({ type: "unlock", durationSec: 999_999 })).ok).toBe(false);
    expect(parseServerMessage(json({ type: "unlock", durationSec: 90.5 })).ok).toBe(false);
    expect(parseServerMessage(json({ type: "unlock", durationSec: "3600" })).ok).toBe(false);
  });

  it("accepts a policy message and rejects a wildcard site", () => {
    const policy = (pattern: string) => ({
      type: "policy",
      policy: { version: 1, apps: [], sites: [{ id: "khan", name: "Khan Academy", pattern }] },
    });
    expect(parseServerMessage(json(policy("khanacademy.org"))).ok).toBe(true);
    expect(parseServerMessage(json(policy("*"))).ok).toBe(false);
  });

  it("accepts a challenge with a 64-hex nonce only", () => {
    expect(parseServerMessage(json({ type: "auth_challenge", nonce: HEX })).ok).toBe(true);
    expect(parseServerMessage(json({ type: "auth_challenge", nonce: "1234" })).ok).toBe(false);
  });
});

describe("shell <-> agent messages", () => {
  it("accepts launchApp with an id and rejects one with a path", () => {
    expect(parseShellRequest(json({ token: HEX, reqId: 1, cmd: "launchApp", appId: "notepad" })).ok).toBe(true);
    expect(
      parseShellRequest(json({ token: HEX, reqId: 1, cmd: "launchApp", appId: "C:\\Windows\\cmd.exe" })).ok,
    ).toBe(false);
  });

  it("rejects a request without a token", () => {
    expect(parseShellRequest(json({ reqId: 1, cmd: "getState" })).ok).toBe(false);
  });

  it("parses a state push", () => {
    const push = {
      type: "push",
      state: { lock: "UNLOCKED", remainingSec: 120, serverOnline: true, apps: [], sites: [] },
    };
    expect(parseAgentToShell(json(push)).ok).toBe(true);
  });
});
