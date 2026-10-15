import type { WebContents } from "electron";
import { clearTimeout as clearMainTimeout, setTimeout as setMainTimeout } from "node:timers";

export const BROWSER_FAVICON_MAX_BYTES = 64 * 1024;
export const BROWSER_FAVICON_TIMEOUT_MS = 2000;
// Not the page's main world (0) or Electron's context-isolated preload world (999).
const FAVICON_WORLD = 1004;
const MAX_DATA_LENGTH = 64 + Math.ceil(BROWSER_FAVICON_MAX_BYTES / 3) * 4;
const active = new WeakSet<object>();
type FaviconGuest = Pick<WebContents, "isDestroyed" | "getURL" | "executeJavaScriptInIsolatedWorld">;

function pngDimensions(bytes: Buffer, limit = 1024): { width: number; height: number } | undefined {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") return;
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (width && height && width <= limit && height <= limit) return { width, height };
}
function boundedJpeg(bytes: Buffer): boolean {
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) return false;
  let offset = 2, framed = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 255) return false;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 217) return framed && offset === bytes.length;
    if (marker === undefined || marker === 0 || marker === 216 || marker === 1 || marker === 220 || marker === 222 || marker === 223
      || (marker >= 208 && marker <= 215)) return false;
    if (offset + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
      // Baseline/extended-sequential/progressive only. Refuse multiple/hierarchical frames.
      if (![192, 193, 194].includes(marker) || framed || length < 8) return false;
      const height = bytes.readUInt16BE(offset + 3), width = bytes.readUInt16BE(offset + 5), components = bytes[offset + 7]!;
      if (!height || !width || height > 1024 || width > 1024 || components < 1 || components > 4 || length !== 8 + 3 * components) return false;
      framed = true;
    }
    offset += length;
    if (marker === 218) {
      if (!framed) return false;
      // Skip entropy bytes, byte stuffing and restart markers to the next actual marker.
      while (offset < bytes.length) {
        if (bytes[offset] !== 255) { offset++; continue; }
        const next = bytes[offset + 1];
        if (next === 0 || (next !== undefined && next >= 208 && next <= 215)) { offset += 2; continue; }
        break;
      }
    }
  }
  return false;
}
function boundedIco(bytes: Buffer): boolean {
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x00010000) return false;
  const count = bytes.readUInt16LE(4), directoryEnd = 6 + count * 16;
  if (!count || count > 16 || directoryEnd > bytes.length) return false;
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16, width = bytes[entry] || 256, height = bytes[entry + 1] || 256;
    const size = bytes.readUInt32LE(entry + 8), start = bytes.readUInt32LE(entry + 12);
    if (start < directoryEnd || size < 24 || start + size > bytes.length) return false;
    const image = bytes.subarray(start, start + size);
    if (image[0] === 137) {
      const dimensions = pngDimensions(image, 256);
      if (!dimensions || dimensions.width !== width || dimensions.height !== height) return false;
    } else {
      // ICO DIB height includes XOR pixels plus its mask. Old/unknown headers fail closed.
      if (image.length < 40 || image.readUInt32LE(0) < 40 || image.readUInt32LE(0) > image.length
        || image.readInt32LE(4) !== width || image.readInt32LE(8) !== height * 2
        || image.readUInt16LE(12) !== 1 || ![1, 4, 8, 16, 24, 32].includes(image.readUInt16LE(14))) return false;
    }
  }
  return true;
}

/** Never pass page-supplied MIME/markup to the app renderer. Only bounded raster bytes survive. */
export function sanitizeBrowserFaviconData(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX_DATA_LENGTH) return;
  const match = /^data:(image\/(?:png|jpeg|x-icon|vnd\.microsoft\.icon));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2]!.length % 4 !== 0) return;
  const bytes = Buffer.from(match[2]!, "base64");
  if (!bytes.length || bytes.length > BROWSER_FAVICON_MAX_BYTES || bytes.toString("base64") !== match[2]) return;
  const mime = match[1] === "image/vnd.microsoft.icon" ? "image/x-icon" : match[1];
  const signature = mime === "image/png" ? !!pngDimensions(bytes) : mime === "image/jpeg" ? boundedJpeg(bytes) : boundedIco(bytes);
  if (!signature) return;
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function fetchScript(url: string, pageUrl: string, deadline: number): string {
  // Only JSON-encoded data changes; no caller-supplied source or evaluator crosses a bridge.
  return `(async () => {
    const url = ${JSON.stringify(url)}, expectedPage = ${JSON.stringify(pageUrl)}, deadline = ${deadline};
    if (Date.now() >= deadline || location.href !== expectedPage) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));
    let reader;
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: "same-origin", mode: "cors",
        redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" });
      if (!response.ok || !response.body || Date.now() >= deadline || location.href !== expectedPage) return;
      const mime = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
      if (!["image/png", "image/jpeg", "image/x-icon", "image/vnd.microsoft.icon"].includes(mime)) return;
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\\d+$/.test(length) || Number(length) > ${BROWSER_FAVICON_MAX_BYTES})) return;
      reader = response.body.getReader();
      const chunks = []; let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (Date.now() >= deadline || location.href !== expectedPage) return;
        if (done) break;
        if (!(value instanceof Uint8Array) || value.byteLength > ${BROWSER_FAVICON_MAX_BYTES} - total) return;
        total += value.byteLength; chunks.push(value);
      }
      if (!total) return;
      let binary = "";
      for (const chunk of chunks) for (const byte of chunk) binary += String.fromCharCode(byte);
      return "data:" + mime + ";base64," + btoa(binary);
    } catch { return; }
    finally {
      clearTimeout(timeout); controller.abort();
      if (reader) void reader.cancel().catch(() => {});
    }
  })()`;
}

/** Fetch at most one approved candidate in the guest's own session. CORS/redirects/errors fall
 * back to the generic icon. The caller MUST fence host/guest/navigation identity before and
 * after awaiting; this helper does not confer host or session authority. Existing per-session
 * webRequest gates remain responsible for subresource egress. No default-session fetch exists. */
export async function readBrowserFavicon(guest: FaviconGuest, candidates: readonly string[],
  isAllowed: (url: string) => boolean): Promise<string | undefined> {
  if (guest.isDestroyed() || active.has(guest) || !Array.isArray(candidates)) return;
  let selected: string | undefined;
  let pageUrl: string;
  try {
    pageUrl = guest.getURL();
    for (const candidate of candidates.slice(0, 8)) {
      if (typeof candidate !== "string") continue;
      if (candidate.startsWith("data:")) {
        const data = sanitizeBrowserFaviconData(candidate);
        if (data) return data;
        continue;
      }
      if (!candidate || candidate.length > 16_384 || /[\x00-\x20\x7f\\]/.test(candidate)) continue;
      const url = new URL(candidate, pageUrl);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
      // Do not canonicalize an absolute URL past policy checks (e.g. alternate loopback IPs).
      if (/^[a-z][a-z\d+.-]*:/i.test(candidate) && !isAllowed(candidate)) continue;
      if (candidate.startsWith("//") && !isAllowed(new URL(pageUrl).protocol + candidate)) continue;
      url.hash = "";
      if (isAllowed(url.href)) { selected = url.href; break; }
    }
    if (!selected || !isAllowed(selected)) return;
  } catch { return; }
  active.add(guest);
  let timer: ReturnType<typeof setMainTimeout> | undefined;
  try {
    const expiry = new Promise<undefined>(resolve => { timer = setMainTimeout(() => resolve(undefined), BROWSER_FAVICON_TIMEOUT_MS); });
    const result = await Promise.race([
      guest.executeJavaScriptInIsolatedWorld(FAVICON_WORLD, [{ code: fetchScript(selected, pageUrl, Date.now() + BROWSER_FAVICON_TIMEOUT_MS) }], false),
      expiry,
    ]);
    if (guest.isDestroyed() || guest.getURL() !== pageUrl || !isAllowed(selected)) return;
    return sanitizeBrowserFaviconData(result);
  } catch { return; }
  finally { if (timer !== undefined) clearMainTimeout(timer); active.delete(guest); }
}
