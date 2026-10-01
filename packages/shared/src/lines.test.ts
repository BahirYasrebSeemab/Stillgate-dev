import { describe, expect, it } from "bun:test";
import { LineSplitter } from "./lines";

describe("LineSplitter", () => {
  it("joins chunks and splits complete lines", () => {
    const splitter = new LineSplitter(100);
    expect(splitter.push('{"a":').lines).toEqual([]);
    expect(splitter.push('1}\n{"b":2}\r\n{"c"').lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(splitter.push(":3}\n").lines).toEqual(['{"c":3}']);
  });

  it("reports overflow when a line grows too long", () => {
    const splitter = new LineSplitter(10);
    expect(splitter.push("x".repeat(11)).overflow).toBe(true);
  });
});
