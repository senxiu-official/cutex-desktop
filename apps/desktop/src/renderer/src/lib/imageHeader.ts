// The pixel size of an inline (data: URL) image from its header, without decoding the image or the whole
// base64 string: a few bytes at known offsets (PNG IHDR, GIF screen, WebP VP8/VP8L/VP8X, BMP DIB, JPEG SOF
// after walking the segment lengths). Null when unsure (AVIF, an EXIF JPEG — its orientation may swap the
// sides — anything malformed): callers then treat the image as of unknown size, exactly as before.

const MAX_JPEG_SEGMENTS = 64;
const MAX_JPEG_OFFSET = 1 << 20;

/** Reads bytes of the base64 payload at byte offsets, decoding only the 4-char groups that cover them. */
function reader(b64: string, start: number) {
  const available = Math.floor((b64.length - start) / 4) * 3;
  return (offset: number, n: number): Uint8Array | null => {
    if (offset < 0 || offset + n > available) return null;
    const first = Math.floor(offset / 3), last = Math.floor((offset + n - 1) / 3);
    let raw: string;
    try { raw = atob(b64.slice(start + first * 4, start + (last + 1) * 4)); } catch { return null; }
    const skip = offset - first * 3;
    if (raw.length < skip + n) return null;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = raw.charCodeAt(skip + i);
    return out;
  };
}

const be16 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const le16 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const le24 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const le32 = (b: Uint8Array, i: number) => (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24));
const ascii = (b: Uint8Array, i: number, s: string) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
const size = (width: number, height: number) => width > 0 && height > 0 && width <= 65535 && height <= 65535 ? { width, height } : null;

export function dataUrlDimensions(url: string): { width: number; height: number } | null {
  if (!url.startsWith("data:image/")) return null;
  const comma = url.indexOf(",", 11);
  if (comma < 0 || comma > 64 || !url.slice(0, comma).endsWith(";base64")) return null;
  const read = reader(url, comma + 1);
  const head = read(0, 30);
  if (!head) return null;
  if (ascii(head, 0, "\x89PNG\r\n\x1a\n") && ascii(head, 12, "IHDR")) return size(((head[16]! << 24) | (head[17]! << 16) | (head[18]! << 8) | head[19]!) >>> 0, ((head[20]! << 24) | (head[21]! << 16) | (head[22]! << 8) | head[23]!) >>> 0);
  if (ascii(head, 0, "GIF8")) return size(le16(head, 6), le16(head, 8));
  if (ascii(head, 0, "RIFF") && ascii(head, 8, "WEBP")) {
    if (ascii(head, 12, "VP8 ") && head[23] === 0x9d && head[24] === 0x01 && head[25] === 0x2a) return size(le16(head, 26) & 0x3fff, le16(head, 28) & 0x3fff);
    if (ascii(head, 12, "VP8L") && head[20] === 0x2f) { const bits = le32(head, 21) >>> 0; return size((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1); }
    if (ascii(head, 12, "VP8X")) return size(le24(head, 24) + 1, le24(head, 27) + 1);
    return null;
  }
  if (ascii(head, 0, "BM")) return size(Math.abs(le32(head, 18)), Math.abs(le32(head, 22)));
  if (head[0] === 0xff && head[1] === 0xd8) return jpegDimensions(read);
  return null;
}

function jpegDimensions(read: (offset: number, n: number) => Uint8Array | null) {
  let pos = 2;
  for (let n = 0; n < MAX_JPEG_SEGMENTS && pos < MAX_JPEG_OFFSET; n++) {
    const b = read(pos, 10);
    if (!b || b[0] !== 0xff) return null;
    const marker = b[1]!;
    if (marker === 0xff) { pos++; continue; } // fill byte
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null; // end / scan data before any frame header
    // APP1 "Exif": the orientation may rotate the shown image; leave it to the decoder.
    if (marker === 0xe1 && ascii(b, 4, "Exif")) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return size(be16(b, 7), be16(b, 5));
    const length = be16(b, 2);
    if (length < 2) return null;
    pos += 2 + length;
  }
  return null;
}
