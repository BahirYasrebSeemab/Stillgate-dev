// Electron's image decoder can't read .ico files (tested: nativeImage gives an empty image).
// An .ico file is a small directory of images. Each image is either:
//   - a PNG file (modern icons)            -> returned as-is
//   - a bare Windows bitmap ("DIB", older) -> decoded here into raw BGRA pixels
// Pure functions, unit-tested. Picks the biggest image.
//
// .ico layout: 6-byte header (0, 1, count), then `count` 16-byte entries:
//   byte 0 width (0 = 256), byte 1 height, ..., bytes 8-11 data size, bytes 12-15 data offset

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HEADER_BYTES = 6;
const ENTRY_BYTES = 16;
const MAX_ENTRIES = 64;
const DIB_HEADER_BYTES = 40;
const MAX_SIDE = 256;

export type IcoImage =
  | { readonly kind: "png"; readonly png: Buffer }
  | { readonly kind: "bgra"; readonly width: number; readonly height: number; readonly pixels: Buffer };

export function bestImageInIco(data: Buffer): IcoImage | null {
  if (data.length < HEADER_BYTES || data.readUInt16LE(0) !== 0 || data.readUInt16LE(2) !== 1) return null;
  const count = Math.min(data.readUInt16LE(4), MAX_ENTRIES);
  let best: { width: number; image: IcoImage } | null = null;
  for (let i = 0; i < count; i++) {
    const entry = HEADER_BYTES + i * ENTRY_BYTES;
    if (entry + ENTRY_BYTES > data.length) break;
    const width = data.readUInt8(entry) || 256;
    const size = data.readUInt32LE(entry + 8);
    const offset = data.readUInt32LE(entry + 12);
    if (offset + size > data.length || size < PNG_SIGNATURE.length) continue;
    const bytes = data.subarray(offset, offset + size);
    const image: IcoImage | null = bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
      ? { kind: "png", png: bytes }
      : decodeDib(bytes);
    if (image !== null && (best === null || width > best.width)) best = { width, image };
  }
  return best?.image ?? null;
}

// Decodes an uncompressed 32-bit or 24-bit icon bitmap into top-down BGRA pixels.
// In an .ico, the bitmap height is doubled (colour rows + a 1-bit transparency "AND mask").
function decodeDib(dib: Buffer): IcoImage | null {
  if (dib.length < DIB_HEADER_BYTES || dib.readUInt32LE(0) !== DIB_HEADER_BYTES) return null;
  const width = dib.readInt32LE(4);
  const height = Math.abs(dib.readInt32LE(8)) / 2;
  const bitCount = dib.readUInt16LE(14);
  const compression = dib.readUInt32LE(16);
  if (compression !== 0 || (bitCount !== 32 && bitCount !== 24)) return null;
  if (!Number.isInteger(height) || width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) return null;

  const bytesPerPixel = bitCount / 8;
  const colorStride = Math.ceil((width * bitCount) / 32) * 4;
  const maskStride = Math.ceil(width / 32) * 4;
  const colorStart = DIB_HEADER_BYTES;
  const maskStart = colorStart + colorStride * height;
  if (maskStart + maskStride * height > dib.length && bitCount === 24) return null;
  if (maskStart > dib.length) return null;

  const pixels = Buffer.alloc(width * height * 4);
  let anyAlpha = false;
  for (let y = 0; y < height; y++) {
    const sourceRow = colorStart + (height - 1 - y) * colorStride; // bitmaps are stored bottom-up
    for (let x = 0; x < width; x++) {
      const source = sourceRow + x * bytesPerPixel;
      const target = (y * width + x) * 4;
      pixels[target] = dib[source] ?? 0; // B
      pixels[target + 1] = dib[source + 1] ?? 0; // G
      pixels[target + 2] = dib[source + 2] ?? 0; // R
      const alpha = bitCount === 32 ? (dib[source + 3] ?? 0) : 255;
      pixels[target + 3] = alpha;
      if (bitCount === 32 && alpha !== 0) anyAlpha = true;
    }
  }
  // No alpha channel used: transparency comes from the AND mask (1 bit per pixel, 1 = transparent)
  if (!anyAlpha && maskStart + maskStride * height <= dib.length) {
    for (let y = 0; y < height; y++) {
      const maskRow = maskStart + (height - 1 - y) * maskStride;
      for (let x = 0; x < width; x++) {
        const bit = ((dib[maskRow + (x >> 3)] ?? 0) >> (7 - (x & 7))) & 1;
        pixels[(y * width + x) * 4 + 3] = bit === 1 ? 0 : 255;
      }
    }
  }
  return { kind: "bgra", width, height, pixels };
}
