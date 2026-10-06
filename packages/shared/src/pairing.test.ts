import { describe, expect, it } from "bun:test";
import { decodePairing, encodePairing } from "./pairing";
import { checkNewPassword } from "./password-rules";

const FP = "0123456789abcdef".repeat(4);

describe("pairing string", () => {
  it("round-trips", () => {
    const info = { ip: "192.168.1.10", port: 47800, fingerprint: FP, code: "ABCD2345" };
    const text = encodePairing(info);
    expect(text).toBe(`sg1:192.168.1.10:47800:${FP}:ABCD2345`);
    expect(decodePairing(text)).toEqual({ ok: true, value: info });
  });

  it("tolerates quotes and spaces from copy-paste", () => {
    const text = `sg1:192.168.1.10:47800:${FP}:ABCD2345`;
    expect(decodePairing(` "${text}" `).ok).toBe(true);
    expect(decodePairing(`'${text}'`).ok).toBe(true);
  });

  it("rejects malformed strings", () => {
    const bad = [
      `asd2:192.168.1.10:47800:${FP}:ABCD2345`,
      `sg1:999.1.1.1:47800:${FP}:ABCD2345`,
      `sg1:192.168.1.10:0:${FP}:ABCD2345`,
      `sg1:192.168.1.10:47800:${FP.toUpperCase()}:ABCD2345`,
      `sg1:192.168.1.10:47800:${FP.slice(2)}:ABCD2345`,
      `sg1:192.168.1.10:47800:${FP}:ABCD234O`, // O is not in the alphabet
      `sg1:192.168.1.10:47800:${FP}:ABCD2345:extra`,
    ];
    for (const text of bad) expect(decodePairing(text).ok).toBe(false);
  });
});

describe("checkNewPassword", () => {
  it("enforces length and confirmation", () => {
    expect(checkNewPassword("short", "short").ok).toBe(false);
    expect(checkNewPassword("long enough pw", "long enough pX").ok).toBe(false);
    expect(checkNewPassword(" padded pass ", " padded pass ").ok).toBe(false);
    expect(checkNewPassword("long enough pw", "long enough pw").ok).toBe(true);
  });
});
