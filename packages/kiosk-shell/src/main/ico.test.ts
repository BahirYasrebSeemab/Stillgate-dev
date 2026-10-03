import { describe, expect, it } from "bun:test";
import { largestPngInIco } from "./ico";

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

describe("largestPngInIco", () => {
  it("returns the biggest embedded PNG (width 0 means 256)", () => {
    const file = ico([[16, PNG(1)], [256, PNG(3)], [48, PNG(2)]]);
    expect(largestPngInIco(file)).toEqual(PNG(3));
  });

  it("skips old BMP-style entries", () => {
    const bmp = Buffer.from([0x28, 0, 0, 0, 1, 2, 3, 4, 5, 6]);
    expect(largestPngInIco(ico([[32, bmp]]))).toBeNull();
    expect(largestPngInIco(ico([[64, bmp], [16, PNG(7)]]))).toEqual(PNG(7));
  });

  it("rejects non-ico data and broken offsets safely", () => {
    expect(largestPngInIco(PNG(1))).toBeNull();
    expect(largestPngInIco(Buffer.alloc(3))).toBeNull();
    const broken = ico([[32, PNG(1)]]);
    broken.writeUInt32LE(999_999, 6 + 12); // offset beyond the file
    expect(largestPngInIco(broken)).toBeNull();
  });
});
