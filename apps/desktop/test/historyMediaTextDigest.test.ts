// Owner 2026-10-26: generated images turned into 图片读取失败 after switching conversations. The rebuilt
// view's `cutex-media:<session>/<sha256>` names the base64 text cutex replaced (cutex media_refs
// `sha_hex(payload)`), not the bytes `GET /v2/sessions/{id}/media/{sha256}` serves; main's read through
// the real client must hand those bytes back (an event blob stays checked against its byte digest).
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ BrowserWindow: {}, dialog: {}, shell: {}, clipboard: {}, nativeImage: {} }));
vi.mock("../src/main/errorLog", () => ({ logError: vi.fn() }));
vi.mock("../src/main/daemonFetch", () => ({ daemonFetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init) }));
import { DaemonService } from "../src/main/daemon";

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const hex = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer)), (b) => b.toString(16).padStart(2, "0")).join("");
let service: DaemonService;
let textSha: string, byteSha: string;
beforeEach(async () => {
  byteSha = await hex(png);
  textSha = await hex(new TextEncoder().encode(Buffer.from(png).toString("base64")));
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const path = new URL(String(input instanceof Request ? input.url : input)).pathname;
    // cutex r263: the media route serves the history media cache entry; the blob route only byte-addressed blobs.
    if (path === `/v2/sessions/cutex.avatar/media/${textSha}` || path === `/v2/sessions/cutex.avatar/blobs/${byteSha}`)
      return new Response(png.slice(), { status: 200, headers: { "Content-Type": "image/png", "Content-Length": String(png.length) } });
    return new Response(JSON.stringify({ code: "not_found", message: "fixture" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }));
  service = new DaemonService(() => {});
  service.useEndpoint({ baseUrl: "http://fixture.invalid", token: "fake" } as never, { remote: true });
});
afterEach(() => { service.stop(); vi.unstubAllGlobals(); });

it("reads a history media reference named by its base64 text digest", async () => {
  expect(textSha).not.toBe(byteSha);
  const media = await service.historyMedia("cutex.avatar", textSha);
  expect(media && "bytes" in media ? [...media.bytes] : media).toEqual([...png]);
});

it("still checks an event blob against its byte digest", async () => {
  const media = await service.eventBlob("cutex.avatar", byteSha, { mime: "image/png", size: png.length });
  expect(media && "bytes" in media ? media.size : null).toBe(png.length);
});
