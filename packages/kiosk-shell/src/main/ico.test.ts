import { describe, expect, it } from "bun:test";
import { bestImageInIco } from "./ico";

const PNG = (marker: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([marker, marker])]);

// Builds an .ico file from entries [width, imageBytes]
function ico(entries: [number, Buffer][]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const directory = entries.map(([width, image]) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(width === 256 ? 0 : width, 0);
    entry.writeUInt32LE(image.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.length;
    return entry;
  });
  return Buffer.concat([header, ...directory, ...entries.map(([, image]) => image)]);
}

// A 2x2 icon bitmap. rows: top-down list of [B,G,R,A] per pixel; mask: top-down 1=transparent
function dib(bitCount: 24 | 32, rows: number[][][], mask: number[][]): Buffer {
  const width = 2;
  const height = 2;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * 2, 8); // doubled in .ico files
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(bitCount, 14);
  const stride = Math.ceil((width * bitCount) / 32) * 4;
  const color = Buffer.alloc(stride * height);
  rows.forEach((row, y) => {
    const base = (height - 1 - y) * stride; // stored bottom-up
    row.forEach((px, x) => px.slice(0, bitCount / 8).forEach((v, i) => (color[base + x * (bitCount / 8) + i] = v)));
  });
  const maskRows = Buffer.alloc(4 * height);
  mask.forEach((row, y) =>
    row.forEach((bit, x) => {
      const at = (height - 1 - y) * 4;
      maskRows.writeUInt8(maskRows.readUInt8(at) | (bit << (7 - x)), at);
    }),
  );
  return Buffer.concat([header, color, maskRows]);
}

describe("bestImageInIco", () => {
  it("returns the biggest embedded PNG (width 0 means 256)", () => {
    const image = bestImageInIco(ico([[16, PNG(1)], [256, PNG(3)], [48, PNG(2)]]));
    expect(image).toEqual({ kind: "png", png: PNG(3) });
  });

  it("decodes a 32-bit bitmap entry with its own alpha, top-down", () => {
    const bitmap = dib(32, [[[1, 2, 3, 255], [4, 5, 6, 128]], [[7, 8, 9, 255], [10, 11, 12, 0]]], [[0, 0], [0, 0]]);
    const image = bestImageInIco(ico([[2, bitmap]]));
    expect(image?.kind).toBe("bgra");
    if (image?.kind === "bgra") {
      expect([image.width, image.height]).toEqual([2, 2]);
      expect([...image.pixels]).toEqual([1, 2, 3, 255, 4, 5, 6, 128, 7, 8, 9, 255, 10, 11, 12, 0]);
    }
  });

  it("uses the transparency mask for 24-bit bitmaps", () => {
    const bitmap = dib(24, [[[1, 2, 3], [4, 5, 6]], [[7, 8, 9], [10, 11, 12]]], [[0, 1], [1, 0]]);
    const image = bestImageInIco(ico([[2, bitmap]]));
    if (image?.kind !== "bgra") throw new Error("expected a bitmap");
    expect([image.pixels[3], image.pixels[7], image.pixels[11], image.pixels[15]]).toEqual([255, 0, 0, 255]);
  });

  it("rejects non-ico data, odd formats and broken offsets safely", () => {
    expect(bestImageInIco(PNG(1))).toBeNull();
    expect(bestImageInIco(Buffer.alloc(3))).toBeNull();
    const eightBit = dib(32, [[[0, 0, 0, 0], [0, 0, 0, 0]], [[0, 0, 0, 0], [0, 0, 0, 0]]], [[0, 0], [0, 0]]);
    eightBit.writeUInt16LE(8, 14); // palette bitmaps are not supported -> skipped
    expect(bestImageInIco(ico([[2, eightBit]]))).toBeNull();
    const broken = ico([[32, PNG(1)]]);
    broken.writeUInt32LE(999_999, 6 + 12); // offset beyond the file
    expect(bestImageInIco(broken)).toBeNull();
  });
});
