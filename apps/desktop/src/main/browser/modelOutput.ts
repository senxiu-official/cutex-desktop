import { MAX_SCREENSHOT_BASE64_LENGTH, ProtocolError, type BrowserSnapshot, type BrowserScreenshotMetadata } from "@cutex-desktop/browser-protocol";
import { browserScreenshotDimensions } from "./capture";

/** Leave room for MCP's text content wrapper. Provider snapshots retain their larger budget. */
export const MODEL_SNAPSHOT_BYTES = 63 * 1024;
export const MODEL_IMAGE_LONG_EDGE = 1600;
export function modelSnapshot<T extends BrowserSnapshot>(snapshot: T, displayUrl: string): T {
  const output = { ...snapshot, url: displayUrl, nodes: [] as BrowserSnapshot["nodes"] };
  let size = Buffer.byteLength(JSON.stringify(output), "utf8");
  let escapedSize = Buffer.byteLength(JSON.stringify(JSON.stringify(output)), "utf8");
  if (size > MODEL_SNAPSHOT_BYTES || escapedSize > MODEL_SNAPSHOT_BYTES) throw new ProtocolError("message_too_large", "Browser snapshot metadata exceeds model budget");
  for (const node of snapshot.nodes) {
    const encoded = JSON.stringify(node), separator = output.nodes.length ? 1 : 0;
    const addition = Buffer.byteLength(encoded, "utf8") + separator;
    const escapedAddition = Buffer.byteLength(JSON.stringify(encoded), "utf8") - 2 + separator;
    if (size + addition > MODEL_SNAPSHOT_BYTES || escapedSize + escapedAddition > MODEL_SNAPSHOT_BYTES) { output.truncated = true; break; }
    output.nodes.push(node); size += addition; escapedSize += escapedAddition;
  }
  return output;
}

export interface BrowserImage {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  resize(options: { width: number; height: number; quality: "best" }): BrowserImage;
  toPNG(): Buffer;
  toJPEG(quality: number): Buffer;
}
export type BrowserImageDecoder = (bytes: Buffer) => BrowserImage;
export type ProviderScreenshot = BrowserScreenshotMetadata & {
  data: string; mimeType: "image/png" | "image/jpeg"; width: number; height: number; pageGeneration: number;
};

/** Decode bounded pixels and scale once. No recapture/retry, no persistence or logging of bytes. */
export function modelScreenshot(source: ProviderScreenshot, decode: BrowserImageDecoder): ProviderScreenshot {
  const parsed = browserScreenshotDimensions(source.mimeType, source.data);
  const bad = () => new ProtocolError("transport_error", "Browser image decode or metadata validation failed");
  if (parsed.width !== source.width || parsed.height !== source.height
    || !Number.isFinite(source.captureRect.width) || !Number.isFinite(source.captureRect.height)
    || source.captureRect.width <= 0 || source.captureRect.height <= 0) throw bad();
  let image: BrowserImage;
  try { image = decode(Buffer.from(source.data, "base64")); } catch { throw bad(); }
  const decoded = image.getSize();
  if (image.isEmpty() || decoded.width !== parsed.width || decoded.height !== parsed.height) throw bad();
  const ratio = Math.min(1, MODEL_IMAGE_LONG_EDGE / Math.max(parsed.width, parsed.height));
  const width = Math.max(1, Math.round(parsed.width * ratio)), height = Math.max(1, Math.round(parsed.height * ratio));
  if (ratio < 1) image = image.resize({ width, height, quality: "best" });
  const bytes = source.mimeType === "image/jpeg" ? image.toJPEG(80) : image.toPNG();
  const data = bytes.toString("base64");
  if (data.length > MAX_SCREENSHOT_BASE64_LENGTH) throw new ProtocolError("message_too_large", "Browser image exceeds model budget");
  const resultSize = browserScreenshotDimensions(source.mimeType, data);
  if (resultSize.width !== width || resultSize.height !== height) throw bad();
  return { ...source, data, width, height, imageScale: { x: width / source.captureRect.width, y: height / source.captureRect.height } };
}
