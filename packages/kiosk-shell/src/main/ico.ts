// Electron's image decoder can't read .ico files (tested: nativeImage gives an empty image).
// But most modern .ico files simply contain PNG images inside. This reads the .ico directory
// and returns the biggest embedded PNG, or null. Pure function, unit-tested.
//
// .ico layout: 6-byte header (0, 1, count), then `count` 16-byte entries:
//   byte 0 width (0 = 256), byte 1 height, ..., bytes 8-11 data size, bytes 12-15 data offset

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HEADER_BYTES = 6;
const ENTRY_BYTES = 16;
const MAX_ENTRIES = 64;

export function largestPngInIco(data: Buffer): Buffer | null {
  if (data.length < HEADER_BYTES || data.readUInt16LE(0) !== 0 || data.readUInt16LE(2) !== 1) return null;
  const count = Math.min(data.readUInt16LE(4), MAX_ENTRIES);
  let best: { width: number; png: Buffer } | null = null;
  for (let i = 0; i < count; i++) {
    const entry = HEADER_BYTES + i * ENTRY_BYTES;
    if (entry + ENTRY_BYTES > data.length) break;
    const width = data.readUInt8(entry) || 256;
    const size = data.readUInt32LE(entry + 8);
    const offset = data.readUInt32LE(entry + 12);
    if (offset + size > data.length || size < PNG_SIGNATURE.length) continue;
    const image = data.subarray(offset, offset + size);
    if (!image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) continue; // old BMP-style entry
    if (best === null || width > best.width) best = { width, png: image };
  }
  return best?.png ?? null;
}
