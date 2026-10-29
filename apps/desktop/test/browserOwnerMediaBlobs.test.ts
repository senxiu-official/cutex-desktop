import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { CutexClient } from "@cutex-desktop/cutex-client";
import { createBrowserOwnerApi } from "../src/main/browser/ownerApi";
import type { BrowserImage } from "../src/main/browser/modelOutput";
import { BrowserRelayError } from "../src/main/browser/relayTypes";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvN8AAAAASUVORK5CYII=";
const bytes = Buffer.from(PNG, "base64"), sha = createHash("sha256").update(bytes).digest("hex");
const descriptor = (extra: Record<string, unknown> = {}) => ({ type: "cutexBlob", blobId: sha, sha256: sha,
  mime: "image/png", size: bytes.length, url: `cutex-blob:cutex.session/${sha}`, ...extra });
const item = (data: unknown = descriptor(), dynamic = false) => dynamic
  ? { id: "item", type: "dynamicToolCall", namespace: "claude", tool: "browser_screenshot", contentItems: [{ type: "inputImage", imageUrl: data }] }
  : { id: "item", type: "mcpToolCall", server: "cutex", tool: "browser_screenshot", result: { content: [{ type: "image", mimeType: "image/png", data }] } };
function fixture(value: unknown = { item: item() }) {
  const fetchRaw = vi.fn(async () => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } }));
  const eventBlob = vi.fn(async () => ({ bytes, mime: "image/png", size: bytes.length }));
  const decoded: BrowserImage = { isEmpty: vi.fn(() => false), getSize: vi.fn(() => ({ width: 1, height: 1 })),
    resize: vi.fn(() => decoded), toPNG: vi.fn(() => bytes), toJPEG: vi.fn(() => Buffer.alloc(0)) };
  const decodeImage = vi.fn(() => decoded), check = vi.fn();
  const client = { fetchRaw, headers: () => ({}), url: (route: string) => `http://bound.test${route}`,
    eventBlob: eventBlob as unknown as CutexClient["eventBlob"] };
  return { api: createBrowserOwnerApi({ client, check, decodeImage }), client, fetchRaw, eventBlob, decoded, decodeImage, check };
}

describe("browser owner bounded session media descriptors", () => {
  it("uses only the authenticated blob route and rejects bad SHA or denied grants without legacy fallback", async () => {
    for (const mode of ["valid", "hash", "denied"] as const) {
      const requests: { url: string; init?: RequestInit }[] = [];
      const f = fixture();
      const client = new CutexClient({ baseUrl: "http://bound.test", token: "dummy-owner-token" }, {
        fetch: async (input, init) => {
          const url = String(input); requests.push({ url, init });
          if (url.includes("/blobs/")) {
            if (mode === "denied") return new Response(null, { status: 403 });
            const body = Buffer.from(bytes); if (mode === "hash") body[body.length - 1]! ^= 1;
            return new Response(body, { headers: { "Content-Type": "image/png", "Content-Length": String(body.length) } });
          }
          return new Response(JSON.stringify({ item: item() }), { headers: { "Content-Type": "application/json" } });
        },
      });
      const legacyMedia = vi.spyOn(client, "historyMedia");
      const api = createBrowserOwnerApi({ client, check: f.check, decodeImage: f.decodeImage });
      if (mode !== "valid") {
        await expect(api.toolItem("cutex.session", "turn", "item")).rejects.toMatchObject({ code: "invalid_result" });
        expect(f.decodeImage).not.toHaveBeenCalled();
      } else expect(await api.toolItem("cutex.session", "turn", "item")).toEqual({ item: item() });
      expect(requests).toHaveLength(2);
      expect(requests[1]!.url).toBe(`http://bound.test/v2/sessions/cutex.session/blobs/${sha}`);
      expect(new Headers(requests[1]!.init?.headers).get("Authorization")).toBe("Bearer dummy-owner-token");
      expect(requests[1]!.init?.redirect).toBe("error");
      expect(legacyMedia).not.toHaveBeenCalled();
    }
  });
  it.each([false, true])("validates bytes but preserves the descriptor in a dynamic=%s reply", async dynamic => {
    const original = item(descriptor(), dynamic), f = fixture({ item: original });
    expect(await f.api.toolItem("cutex.session", "turn", "item")).toEqual({ item: original });
    expect(f.eventBlob).toHaveBeenCalledExactlyOnceWith("cutex.session", sha, { mime: "image/png", size: bytes.length });
    expect(f.decodeImage).toHaveBeenCalledExactlyOnceWith(bytes);
    expect(f.fetchRaw).toHaveBeenCalledOnce();
    expect(JSON.stringify(original)).not.toContain(PNG);
  });
  it("rejects wrong session, malformed hashes, arbitrary routes, unsupported MIME and oversize before fetching bytes", async () => {
    for (const bad of [descriptor({ url: `cutex-blob:cutex.other/${sha}` }), descriptor({ url: `cutex-media:cutex.session/${sha}` }), descriptor({ sha256: "0".repeat(64) }),
      descriptor({ url: "https://outside.test/p.png" }), descriptor({ url: "file:///private.png" }),
      descriptor({ mime: "image/svg+xml" }), descriptor({ mime: "image/jpeg" }), descriptor({ size: 6 * 1024 * 1024 + 1 }),
      descriptor({ size: -1 }), { type: "imageNotLoaded" }]) {
      const f = fixture({ item: item(bad) });
      await expect(f.api.toolItem("cutex.session", "turn", "item")).rejects.toMatchObject({ code: "invalid_result" });
      expect(f.eventBlob).not.toHaveBeenCalled(); expect(f.decodeImage).not.toHaveBeenCalled();
    }
  });
  it("keeps exact tool identity, one image, and node/depth bounds before media I/O", async () => {
    let deep: unknown = "end"; for (let i = 0; i < 26; i++) deep = { child: deep };
    const first = item();
    for (const bad of [{ ...first, server: "other" }, { ...first, tool: "read_file" }, { ...first, extra: descriptor() },
      item(descriptor({ extra: deep })), item(descriptor({ extra: Array(20_001).fill(0) })),
      { ...first, result: { content: [first.result!.content[0], first.result!.content[0]] } }]) {
      const f = fixture({ item: bad });
      await expect(f.api.toolItem("cutex.session", "turn", "item")).rejects.toMatchObject({ code: "invalid_result" });
      expect(f.eventBlob).not.toHaveBeenCalled();
    }
  });
  it("rejects missing or unverifiable media without fallback", async () => {
    for (const result of [null, { bytes, mime: "image/jpeg", size: bytes.length }, { bytes, mime: "image/png", size: bytes.length + 1 },
      { bytes: bytes.subarray(1), mime: "image/png", size: bytes.length }]) {
      const f = fixture(); f.eventBlob.mockResolvedValue(result as Awaited<ReturnType<typeof f.eventBlob>>);
      await expect(f.api.toolItem("cutex.session", "turn", "item")).rejects.toMatchObject({ code: "invalid_result" });
      expect(f.fetchRaw).toHaveBeenCalledOnce(); expect(f.decodeImage).not.toHaveBeenCalled();
    }
    const f = fixture(); f.eventBlob.mockRejectedValue(new Error("private transport detail"));
    await expect(f.api.toolItem("cutex.session", "turn", "item")).rejects.toMatchObject({ code: "invalid_result", message: "invalid_result" });
  });
  it("requires full native decode and agreement with framing dimensions", async () => {
    for (const failure of ["throw", "empty", "size"] as const) {
      const f = fixture();
      if (failure === "throw") f.decodeImage.mockImplementation(() => { throw Error("private decode"); });
      if (failure === "empty") vi.mocked(f.decoded.isEmpty).mockReturnValue(true);
      if (failure === "size") vi.mocked(f.decoded.getSize).mockReturnValue({ width: 2, height: 1 });
      await expect(f.api.toolItem("cutex.session", "turn", "item")).rejects.toMatchObject({ code: "invalid_result" });
    }
  });
  it("rejects corrupt or oversized dimensions before native decode", async () => {
    const wide = Buffer.from(bytes); wide.writeUInt32BE(1601, 16);
    for (const bad of [wide, Buffer.from("invalid")]) {
      const f = fixture({ item: item(descriptor({ size: bad.length })) });
      f.eventBlob.mockResolvedValue({ bytes: bad, mime: "image/png", size: bad.length });
      await expect(f.api.toolItem("cutex.session", "turn", "item")).rejects.toMatchObject({ code: "invalid_result" });
      expect(f.decodeImage).not.toHaveBeenCalled();
    }
  });
  it("rejects stale connections after a media read", async () => {
    const f = fixture(); f.eventBlob.mockImplementation(async () => {
      f.check.mockImplementation(() => { throw new BrowserRelayError("stale_connection"); });
      return { bytes, mime: "image/png", size: bytes.length };
    });
    await expect(f.api.toolItem("cutex.session", "turn", "item")).rejects.toMatchObject({ code: "stale_connection" });
    expect(f.decodeImage).not.toHaveBeenCalled();
  });
  it("keeps inline-only clients compatible and fails closed without the byte reader", async () => {
    const f = fixture(); delete (f.client as Partial<typeof f.client>).eventBlob;
    await expect(f.api.toolItem("cutex.session", "turn", "item")).rejects.toMatchObject({ code: "invalid_result" });
  });
  it("does not resolve direct turn-shot descriptors without a requested session binding", async () => {
    const f = fixture({ mimeType: "image/png", data: descriptor() });
    await expect(f.api.turnShot("shot")).rejects.toMatchObject({ code: "invalid_result" });
    expect(f.eventBlob).not.toHaveBeenCalled(); expect(f.decodeImage).not.toHaveBeenCalled();
  });
});
