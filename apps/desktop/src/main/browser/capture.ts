import { MAX_SCREENSHOT_BASE64_LENGTH, ProtocolError } from "@cutex-desktop/browser-protocol";

const MAX_DIMENSION = 16_384;
const MAX_PIXELS = 16_777_216;
const invalid = () => new ProtocolError("transport_error", "Invalid bounded browser screenshot");
function dimensions(width: number, height: number): { width: number; height: number } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) throw invalid();
  return { width, height };
}

/** Parse bytes in main; never trust a renderer/NativeImage-reported logical size or decode pixels. */
export function browserScreenshotDimensions(mimeType: "image/png" | "image/jpeg", data: string): { width: number; height: number } {
  if (typeof data !== "string" || !data || data.length > MAX_SCREENSHOT_BASE64_LENGTH || data.length % 4
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw invalid();
  const bytes = Buffer.from(data, "base64");
  if (bytes.toString("base64") !== data) throw invalid();
  if (mimeType === "image/png") {
    if (bytes.length < 33 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
      || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") throw invalid();
    return dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  }
  if (mimeType !== "image/jpeg" || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw invalid();
  let offset = 2;
  for (let segments = 0; segments < 1024 && offset < bytes.length; segments++) {
    if (bytes[offset++] !== 0xff) throw invalid();
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0 || marker === 0xd8 || marker === 0xd9 || marker === 0xda) throw invalid();
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) throw invalid();
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw invalid();
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8 || length !== 8 + 3 * bytes[offset + 7]!) throw invalid();
      return dimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
    }
    offset += length;
  }
  throw invalid();
}
