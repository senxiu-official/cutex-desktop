import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BROWSER_FAVICON_MAX_BYTES, BROWSER_FAVICON_TIMEOUT_MS, readBrowserFavicon, sanitizeBrowserFaviconData } from "../src/main/browser/favicon";
import { createBrowserUrlPolicy } from "../src/main/browser/network";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lmQAAAAASUVORK5CYII=", "base64");
const pngData = `data:image/png;base64,${png.toString("base64")}`;
const jpeg = Buffer.from("ffd8ffc00011080001000103011100021100031100ffd9", "hex");
function icoFor(image = png) {
  const header = Buffer.alloc(22); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header[6] = 1; header[7] = 1; header.writeUInt32LE(image.length, 14); header.writeUInt32LE(22, 18);
  return Buffer.concat([header, image]);
}
const allowed = createBrowserUrlPolicy({ getHost: () => ({ kind: "local" }) }).isRequestAllowed;
function fixture(result: unknown = pngData) {
  const guest = { isDestroyed: vi.fn(() => false), getURL: vi.fn(() => "http://localhost:26111/page"),
    executeJavaScriptInIsolatedWorld: vi.fn(async (_world: number, _scripts: { code: string }[], _gesture?: boolean): Promise<unknown> => result) };
  return guest;
}
function response(bytes: Uint8Array[] = [png], mime = "image/png", length: string | null = null) {
  let i = 0;
  const reader = { read: vi.fn(async () => i < bytes.length ? { done: false, value: bytes[i++] } : { done: true }), cancel: vi.fn(async () => {}) };
  return { reader, ok: true, body: { getReader: () => reader },
    headers: { get: (name: string) => name === "content-type" ? mime : length } };
}
function executingFixture(fetch: (...args: any[]) => unknown) {
  const guest = fixture();
  const location = { href: guest.getURL() };
  guest.executeJavaScriptInIsolatedWorld.mockImplementation(async (_world, scripts) => runInNewContext(scripts[0]!.code, {
    fetch, location, Date, Uint8Array, AbortController, setTimeout, clearTimeout,
    btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
  }));
  return { guest, location };
}
afterEach(() => { vi.useRealTimers(); });

describe("browser favicon sanitizer", () => {
  it("accepts bounded PNG and canonicalizes ICO MIME aliases", () => {
    expect(sanitizeBrowserFaviconData(pngData)).toBe(pngData);
    const encoded = icoFor().toString("base64");
    expect(sanitizeBrowserFaviconData(`data:image/vnd.microsoft.icon;base64,${encoded}`)).toBe(`data:image/x-icon;base64,${encoded}`);
  });
  it("accepts bounded JPEG frames and ICO DIB dimensions", () => {
    const jpegData = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    expect(sanitizeBrowserFaviconData(jpegData)).toBe(jpegData);
    const dib = Buffer.alloc(48); dib.writeUInt32LE(40); dib.writeInt32LE(1, 4); dib.writeInt32LE(2, 8);
    dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14);
    expect(sanitizeBrowserFaviconData(`data:image/x-icon;base64,${icoFor(dib).toString("base64")}`)).toBeDefined();
  });
  it("rejects huge or malformed JPEG frames and ICO embedded PNG/DIB images", () => {
    const hugeJpeg = Buffer.from(jpeg); hugeJpeg.writeUInt16BE(65535, 9);
    const truncatedJpeg = jpeg.subarray(0, 14);
    const hugePng = Buffer.from(png); hugePng.writeUInt32BE(100_000, 16);
    const hugeDib = Buffer.alloc(40); hugeDib.writeUInt32LE(40); hugeDib.writeInt32LE(100_000, 4); hugeDib.writeInt32LE(200_000, 8);
    hugeDib.writeUInt16LE(1, 12); hugeDib.writeUInt16LE(32, 14);
    for (const value of [hugeJpeg, truncatedJpeg])
      expect(sanitizeBrowserFaviconData(`data:image/jpeg;base64,${value.toString("base64")}`)).toBeUndefined();
    for (const value of [icoFor(hugePng), icoFor(hugeDib), Buffer.alloc(22)])
      expect(sanitizeBrowserFaviconData(`data:image/x-icon;base64,${value.toString("base64")}`)).toBeUndefined();
  });
  it.each([null, {}, 7, "data:image/svg+xml;base64,PHN2Zy8+", "data:text/html;base64,PHN2Zy8+",
    "data:image/png,raw", "data:image/png;base64,a===", "data:image/png;base64,AAAA", "data:image/jpeg;base64,PHN2Zy8+",
    "data:image/png;charset=utf-8;base64,AAAA"])("rejects malformed, wrong-signature or active MIME input: %s", value => {
    expect(sanitizeBrowserFaviconData(value)).toBeUndefined();
  });
  it("rejects oversized encoded data and implausibly large PNG dimensions", () => {
    expect(sanitizeBrowserFaviconData(`data:image/png;base64,${Buffer.alloc(BROWSER_FAVICON_MAX_BYTES + 1).toString("base64")}`)).toBeUndefined();
    const huge = Buffer.from(png); huge.writeUInt32BE(100_000, 16);
    expect(sanitizeBrowserFaviconData(`data:image/png;base64,${huge.toString("base64")}`)).toBeUndefined();
  });
});

describe("browser guest-only favicon helper", () => {
  it("returns a valid data image without executing script or doing a network fetch", async () => {
    const guest = fixture();
    expect(await readBrowserFavicon(guest, [pngData], () => false)).toBe(pngData);
    expect(guest.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
  });
  it.each(["https://example.com/icon.png", "file:///icon.png", "javascript:alert(1)", "blob:http://localhost/id",
    "http://user:pass@localhost/icon", "http://127.1/icon", "//127.1/icon", "http://localhost\\evil/icon", "http://localhost/icon\n.png"])("does not execute disallowed candidate %s", async candidate => {
    const guest = fixture();
    expect(await readBrowserFavicon(guest, [candidate], allowed)).toBeUndefined();
    expect(guest.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
  });
  it("resolves relative URLs with no user gesture and safely JSON-encodes candidate source", async () => {
    const data = response(); const fetch = vi.fn(async () => data);
    const { guest } = executingFixture(fetch);
    const url = "/icon.png?q=';globalThis.bad=true;//";
    expect(await readBrowserFavicon(guest, [url], allowed)).toBe(pngData);
    const [world, scripts, gesture] = guest.executeJavaScriptInIsolatedWorld.mock.calls[0]!;
    expect(world).not.toBe(0); expect(world).not.toBe(999); expect(gesture).toBe(false);
    expect(scripts).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(new URL(url, guest.getURL()).href, expect.objectContaining({
      credentials: "same-origin", mode: "cors", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer",
    }));
    expect(data.reader.cancel).toHaveBeenCalledOnce();
  });
  it("limits candidate search and executes at most one fetch even if it fails", async () => {
    const guest = fixture(undefined);
    expect(await readBrowserFavicon(guest, Array(8).fill("https://example.com/icon").concat("/valid.png"), allowed)).toBeUndefined();
    expect(guest.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
    guest.executeJavaScriptInIsolatedWorld.mockResolvedValue(undefined);
    expect(await readBrowserFavicon(guest, ["/a.png", "/b.png"], allowed)).toBeUndefined();
    expect(guest.executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce();
  });
  it("denies malformed renderer results and rejected execution", async () => {
    const guest = fixture("data:image/svg+xml;base64,PHN2Zy8+");
    expect(await readBrowserFavicon(guest, ["/icon"], allowed)).toBeUndefined();
    guest.executeJavaScriptInIsolatedWorld.mockRejectedValue(new Error("destroyed"));
    expect(await readBrowserFavicon(guest, ["/icon"], allowed)).toBeUndefined();
  });
  it.each(["page", "policy", "destroyed"])("ignores a reply after %s changed", async change => {
    const guest = fixture(); let current = true;
    guest.executeJavaScriptInIsolatedWorld.mockImplementation(async () => {
      if (change === "page") guest.getURL.mockReturnValue("http://localhost:26111/new");
      if (change === "policy") current = false;
      if (change === "destroyed") guest.isDestroyed.mockReturnValue(true);
      return pngData;
    });
    expect(await readBrowserFavicon(guest, ["/icon"], url => current && allowed(url))).toBeUndefined();
  });
  it("bounds unresolved execution in main and refuses concurrent work for the same guest", async () => {
    vi.useFakeTimers();
    const guest = fixture(); guest.executeJavaScriptInIsolatedWorld.mockReturnValue(new Promise(() => {}));
    const pending = readBrowserFavicon(guest, ["/icon"], allowed);
    expect(await readBrowserFavicon(guest, ["/other"], allowed)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(BROWSER_FAVICON_TIMEOUT_MS);
    expect(await pending).toBeUndefined(); expect(guest.executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce();
    guest.executeJavaScriptInIsolatedWorld.mockResolvedValue(pngData);
    expect(await readBrowserFavicon(guest, ["/new"], allowed)).toBe(pngData);
  });
});

describe("fixed favicon script behavior (mock fetch, no network)", () => {
  it("streams multiple bounded chunks and normalizes response MIME", async () => {
    const data = response([png.subarray(0, 20), png.subarray(20)], " Image/PNG ; charset=binary");
    const { guest } = executingFixture(vi.fn(async () => data));
    expect(await readBrowserFavicon(guest, ["/icon"], allowed)).toBe(pngData);
    expect(data.reader.read).toHaveBeenCalledTimes(3);
  });
  it.each(["image/svg+xml", "text/html", "application/octet-stream", ""])("rejects response MIME %s before reading bytes", async mime => {
    const data = response([png], mime); const { guest } = executingFixture(vi.fn(async () => data));
    expect(await readBrowserFavicon(guest, ["/icon"], allowed)).toBeUndefined();
    expect(data.reader.read).not.toHaveBeenCalled();
  });
  it.each([String(BROWSER_FAVICON_MAX_BYTES + 1), "-1", "NaN"])("rejects unsafe Content-Length %s", async length => {
    const data = response([png], "image/png", length); const { guest } = executingFixture(vi.fn(async () => data));
    expect(await readBrowserFavicon(guest, ["/icon"], allowed)).toBeUndefined();
    expect(data.reader.read).not.toHaveBeenCalled();
  });
  it("cancels a stream as soon as actual bytes exceed the cap, including dishonest content length", async () => {
    const data = response([new Uint8Array(BROWSER_FAVICON_MAX_BYTES), new Uint8Array(1), png], "image/png", "1");
    const { guest } = executingFixture(vi.fn(async () => data));
    expect(await readBrowserFavicon(guest, ["/icon"], allowed)).toBeUndefined();
    expect(data.reader.read).toHaveBeenCalledTimes(2); expect(data.reader.cancel).toHaveBeenCalledOnce();
  });
  it("falls back on CORS/network/redirect errors", async () => {
    const { guest } = executingFixture(vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await readBrowserFavicon(guest, ["/icon"], allowed)).toBeUndefined();
  });
  it("aborts a hanging fetch after the fixed deadline", async () => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined;
    const { guest } = executingFixture((_url, options) => {
      signal = options.signal;
      return new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(new Error("aborted"))));
    });
    const pending = readBrowserFavicon(guest, ["/icon"], allowed);
    await vi.advanceTimersByTimeAsync(BROWSER_FAVICON_TIMEOUT_MS);
    expect(await pending).toBeUndefined(); expect(signal?.aborted).toBe(true);
  });
  it.each(["deadline", "page"])("a script queued during loading cannot fetch after its %s changed", async reason => {
    vi.useFakeTimers(); const guest = fixture(); const fetch = vi.fn();
    const pending = readBrowserFavicon(guest, ["/icon"], allowed);
    const script = guest.executeJavaScriptInIsolatedWorld.mock.calls[0]![1][0]!.code;
    await pending;
    if (reason === "deadline") await vi.advanceTimersByTimeAsync(BROWSER_FAVICON_TIMEOUT_MS);
    expect(await runInNewContext(script, { Date, location: { href: reason === "page" ? "http://localhost/other" : guest.getURL() }, fetch })).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
