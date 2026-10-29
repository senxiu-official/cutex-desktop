import { afterEach, describe, expect, it, vi } from "vitest";
import { CutexApiError, CutexClient, CutexUnreachableError, HISTORY_MEDIA_DESCRIPTOR_MAX_BYTES, HISTORY_MEDIA_MAX_BYTES, type HistoryMediaBytesOptions } from "../src/index";

const payload = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const sha = async (bytes: Uint8Array<ArrayBuffer>) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
const hash = await sha(payload);
const bytesOptions: HistoryMediaBytesOptions = { transport: "bytes" };
function client(response: Response | ((input: string | URL | Request, init?: RequestInit) => Promise<Response>)) {
  const fetch = vi.fn(typeof response === "function" ? response : async () => response);
  return { client: new CutexClient({ baseUrl: "https://host.example:123", token: "owner-token" }, { fetch: fetch as typeof globalThis.fetch, clientId: "desktop-test" }), fetch };
}
function streamed(parts: Uint8Array[], headers: Record<string, string> = {}, status = 200) {
  let index = 0;
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => { if (index === parts.length) controller.close(); else controller.enqueue(parts[index++]!); });
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
  return { response: new Response(body, { status, headers: { "Content-Type": "image/png", ...headers } }), pull, cancel };
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("authenticated media bytes", () => {
  it("streams the fixed authenticated route, verifies bytes and never calls base64, arrayBuffer or text", async () => {
    const body = streamed([payload.subarray(0, 3), payload.subarray(3)], { "Content-Type": "IMAGE/PNG; charset=binary", "Content-Length": String(payload.length) });
    const btoa = vi.spyOn(globalThis, "btoa").mockImplementation(() => { throw new Error("base64 forbidden"); });
    const arrayBuffer = vi.spyOn(body.response, "arrayBuffer"), text = vi.spyOn(body.response, "text");
    const { client: api, fetch } = client(body.response);
    expect(await api.historyMedia("cutex.session:1", hash, { transport: "bytes", expected: { mime: "image/png", size: payload.length } })).toEqual({ bytes: payload, mime: "image/png", size: payload.length });
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(`https://host.example:123/v2/sessions/cutex.session%3A1/media/${hash}`);
    expect(init).toMatchObject({ redirect: "error", headers: { Authorization: "Bearer owner-token", Accept: "*/*" } });
    expect(init?.signal?.aborted).toBe(false);
    expect(btoa).not.toHaveBeenCalled(); expect(arrayBuffer).not.toHaveBeenCalled(); expect(text).not.toHaveBeenCalled();
  });

  it("accepts generic descriptor MIME types and snapshots caller metadata", async () => {
    const expected = { mime: "application/pdf", size: payload.length };
    const body = streamed([payload], { "Content-Type": "application/pdf" });
    const { client: api } = client(async () => { expected.mime = "text/plain"; expected.size = 1; return body.response; });
    expect(await api.historyMedia("s", hash, { transport: "bytes", expected })).toEqual({ bytes: payload, mime: "application/pdf", size: payload.length });
  });

  it.each(["", ".", "..", "a/b", "../s", "s?other=1", "s#fragment", "https://elsewhere", "x".repeat(201)])("rejects session %j before fetching", async sessionId => {
    const { client: api, fetch } = client(new Response(payload));
    await expect(api.historyMedia(sessionId, hash, bytesOptions)).rejects.toThrow("bad media session id");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["a".repeat(63), "a".repeat(65), "A".repeat(64), "../" + "a".repeat(64), "x".repeat(64)])("rejects malformed hash %j before fetching", async invalid => {
    const { client: api, fetch } = client(new Response(payload));
    await expect(api.historyMedia("s", invalid, bytesOptions)).rejects.toThrow("bad media hash");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { mime: "image/png", size: -1 }, { mime: "image/png", size: 1.5 }, { mime: "image/png", size: Number.MAX_SAFE_INTEGER + 1 },
    { mime: "image/png", size: HISTORY_MEDIA_DESCRIPTOR_MAX_BYTES + 1 }, { mime: "image/png; extra=true", size: 1 },
    { mime: "image/png\n", size: 1 }, { mime: "x".repeat(128) + "/png", size: 1 }, { mime: "image/png", size: 1, url: "https://arbitrary.example" },
    { mime: "image/png" }, { size: 1 }, null, [],
  ])("rejects malformed expected metadata before fetching: %j", async expected => {
    const { client: api, fetch } = client(new Response(payload));
    await expect(api.historyMedia("s", hash, { transport: "bytes", expected } as unknown as HistoryMediaBytesOptions)).rejects.toThrow("bad expected media descriptor");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects arbitrary URL transport options", async () => {
    const { client: api, fetch } = client(new Response(payload));
    await expect(api.historyMedia("s", hash, { transport: "bytes", url: "https://arbitrary.example" } as unknown as HistoryMediaBytesOptions)).rejects.toThrow("bad media transport options");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([String(HISTORY_MEDIA_MAX_BYTES + 1), "NaN", "1.5", "-1", "0", "9007199254740992"])("refuses invalid/oversized Content-Length %s before reading", async length => {
    const body = streamed([payload], { "Content-Length": length }); const { client: api, fetch } = client(body.response);
    expect(await api.historyMedia("s", hash, bytesOptions)).toBeNull();
    expect(body.pull).not.toHaveBeenCalled(); expect(body.cancel).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  });
  it("cancels a declared size mismatch without reading its body", async () => {
    const body = streamed([payload], { "Content-Length": "8" }); const { client: api } = client(body.response);
    expect(await api.historyMedia("s", hash, { transport: "bytes", expected: { mime: "image/png", size: 7 } })).toBeNull();
    expect(body.pull).not.toHaveBeenCalled(); expect(body.cancel).toHaveBeenCalledOnce();
  });
  it("cancels chunked media as soon as it exceeds its expected size", async () => {
    const body = streamed([payload.subarray(0, 4), payload.subarray(4), payload]); const { client: api } = client(body.response);
    expect(await api.historyMedia("s", hash, { transport: "bytes", expected: { mime: "image/png", size: 6 } })).toBeNull();
    expect(body.pull).toHaveBeenCalledTimes(2); expect(body.cancel).toHaveBeenCalledOnce();
  });
  it("enforces the legacy 64 MiB streaming ceiling even without Content-Length or expected metadata", async () => {
    const part = new Uint8Array(8 * 1024 * 1024);
    const body = streamed(Array.from({ length: 10 }, () => part)); const { client: api } = client(body.response);
    expect(await api.historyMedia("s", hash, bytesOptions)).toBeNull();
    expect(body.pull).toHaveBeenCalledTimes(9); expect(body.cancel).toHaveBeenCalledOnce();
  });
  it("enforces the descriptor 32 MiB ceiling in a chunked response", async () => {
    const part = new Uint8Array(8 * 1024 * 1024);
    const body = streamed(Array.from({ length: 6 }, () => part)); const { client: api } = client(body.response);
    expect(await api.historyMedia("s", hash, { transport: "bytes", expected: { mime: "image/png", size: HISTORY_MEDIA_DESCRIPTOR_MAX_BYTES } })).toBeNull();
    expect(body.pull).toHaveBeenCalledTimes(5); expect(body.cancel).toHaveBeenCalledOnce();
  });
  it.each(["", "not-a-mime", "image/png/extra", "image/", "x".repeat(600)])("rejects invalid response MIME %j without consuming it", async mime => {
    const body = streamed([payload], { "Content-Type": mime }); const { client: api } = client(body.response);
    expect(await api.historyMedia("s", hash, bytesOptions)).toBeNull(); expect(body.pull).not.toHaveBeenCalled(); expect(body.cancel).toHaveBeenCalledOnce();
  });
  it("rejects MIME, actual size and declared length mismatches", async () => {
    const cases = [
      client(streamed([payload], { "Content-Type": "image/jpeg" }).response).client.historyMedia("s", hash, { transport: "bytes", expected: { mime: "image/png", size: 7 } }),
      client(streamed([payload]).response).client.historyMedia("s", hash, { transport: "bytes", expected: { mime: "image/png", size: 8 } }),
      client(streamed([payload], { "Content-Length": "8" }).response).client.historyMedia("s", hash, bytesOptions),
    ];
    expect(await Promise.all(cases)).toEqual([null, null, null]);
  });
  it("history media refs are cache keys, not byte hashes: a ref named by the base64 text still returns the bytes", async () => {
    // cutex names a media ref by the SHA-256 of the base64 payload (media_refs.rs) and serves the decoded bytes.
    const ref = await sha(new Uint8Array(new TextEncoder().encode(Buffer.from(payload).toString("base64"))));
    expect(ref).not.toBe(hash);
    expect(await client(streamed([payload]).response).client.historyMedia("s", ref, bytesOptions)).toEqual({ bytes: payload, mime: "image/png", size: payload.length });
  });
  it("an event blob is named by its bytes: a digest mismatch is still refused", async () => {
    expect(await client(streamed([payload]).response).client.eventBlob("s", "a".repeat(64))).toBeNull();
  });
  it("returns null for empty content, including valid zero-size metadata", async () => {
    expect(await client(streamed([]).response).client.historyMedia("s", hash, bytesOptions)).toBeNull();
    expect(await client(streamed([]).response).client.historyMedia("s", hash, { transport: "bytes", expected: { mime: "image/png", size: 0 } })).toBeNull();
  });
  it.each([403, 404, 405])("returns null for status %s and cancels its unread response", async status => {
    const body = streamed([payload], {}, status); const { client: api } = client(body.response);
    expect(await api.historyMedia("s", hash, bytesOptions)).toBeNull(); expect(body.pull).not.toHaveBeenCalled(); expect(body.cancel).toHaveBeenCalledOnce();
  });
  it.each([401, 413, 429, 500])("throws a bounded typed status %s without reading an error body", async status => {
    const body = streamed([new Uint8Array(1024 * 1024)], {}, status); const { client: api } = client(body.response);
    const error = await api.historyMedia("s", hash, bytesOptions).catch(error => error);
    expect(error).toBeInstanceOf(CutexApiError); expect(error).toMatchObject({ status, code: `http_${status}` }); expect(error.message.length).toBeLessThan(200);
    expect(body.pull).not.toHaveBeenCalled(); expect(body.cancel).toHaveBeenCalledOnce();
  });
  it("bounds the whole request when fetch ignores abort", async () => {
    vi.useFakeTimers(); const { client: api, fetch } = client(() => new Promise<Response>(() => {}));
    const rejected = expect(api.historyMedia("s", hash, bytesOptions)).rejects.toMatchObject({ code: "history_media_timeout" });
    await vi.advanceTimersByTimeAsync(15000); await rejected;
    expect(fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  });
  it("aborts a stalled stream at the same overall deadline", async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}), cancel }, { highWaterMark: 0 });
    const { client: api, fetch } = client(new Response(body, { headers: { "Content-Type": "image/png" } }));
    const rejected = expect(api.historyMedia("s", hash, bytesOptions)).rejects.toMatchObject({ code: "history_media_timeout" });
    await vi.advanceTimersByTimeAsync(15000); await rejected;
    expect(cancel).toHaveBeenCalled(); expect(fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  });
  it("does not wait for an uncooperative cancellation on a refused response", async () => {
    const body = new ReadableStream<Uint8Array>({ cancel: () => new Promise<void>(() => {}) }, { highWaterMark: 0 });
    expect(await client(new Response(body, { headers: { "Content-Type": "image/png", "Content-Length": String(HISTORY_MEDIA_MAX_BYTES + 1) } })).client.historyMedia("s", hash, bytesOptions)).toBeNull();
  });
  it("keeps the existing two-argument Base64 image contract", async () => {
    const { client: api } = client(new Response(payload, { headers: { "Content-Type": "image/png", ETag: '\"etag\"' } }));
    expect(await api.historyMedia("s", hash)).toEqual({ contentType: "image/png", data: btoa(String.fromCharCode(...payload)), etag: "etag" });
  });
  it("preserves the typed unreachable error for network failures", async () => {
    const { client: api } = client(async () => { throw new TypeError("network failed"); });
    await expect(api.historyMedia("s", hash, bytesOptions)).rejects.toBeInstanceOf(CutexUnreachableError);
  });
});

describe("granted event blobs stay separate from owner-only history media", () => {
  it("uses the authenticated /blobs route and retains both /media overloads", async () => {
    const { client: api, fetch } = client(async () => streamed([payload]).response);
    expect(await api.eventBlob("cutex.s", hash, { mime: "image/png", size: payload.length })).toEqual({ bytes: payload, mime: "image/png", size: payload.length });
    expect(await api.historyMedia("cutex.s", hash, bytesOptions)).toEqual({ bytes: payload, mime: "image/png", size: payload.length });
    expect(await api.historyMedia("cutex.s", hash)).toMatchObject({ contentType: "image/png", data: btoa(String.fromCharCode(...payload)) });
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      `https://host.example:123/v2/sessions/cutex.s/blobs/${hash}`,
      `https://host.example:123/v2/sessions/cutex.s/media/${hash}`,
      `https://host.example:123/v2/sessions/cutex.s/media/${hash}`,
    ]);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: "error", headers: { Authorization: "Bearer owner-token" } });
  });
  it("defaults blobs to 32 MiB while legacy bytes refs retain the 64 MiB cap", async () => {
    const blob = streamed([payload], { "Content-Length": String(HISTORY_MEDIA_DESCRIPTOR_MAX_BYTES + 1) });
    expect(await client(blob.response).client.eventBlob("s", hash)).toBeNull();
    expect(blob.pull).not.toHaveBeenCalled(); expect(blob.cancel).toHaveBeenCalledOnce();
    const legacy = streamed([payload], { "Content-Length": String(HISTORY_MEDIA_DESCRIPTOR_MAX_BYTES + 1) });
    expect(await client(legacy.response).client.historyMedia("s", hash, bytesOptions)).toBeNull(); // actual size differs, after the permitted read
    expect(legacy.pull).toHaveBeenCalled();
  });
  it("also bounds chunked blobs to 32 MiB with no descriptor", async () => {
    const part = new Uint8Array(8 * 1024 * 1024), body = streamed(Array.from({ length: 6 }, () => part));
    expect(await client(body.response).client.eventBlob("s", hash)).toBeNull();
    expect(body.pull).toHaveBeenCalledTimes(5); expect(body.cancel).toHaveBeenCalledOnce();
  });
  it.each([403, 404, 405])("does not fall back to /media after a blob grant/route refusal %s", async status => {
    const body = streamed([payload], {}, status), { client: api, fetch } = client(body.response);
    expect(await api.eventBlob("s", hash, { mime: "image/png", size: payload.length })).toBeNull();
    expect(fetch).toHaveBeenCalledOnce(); expect(String(fetch.mock.calls[0]![0])).toContain(`/blobs/${hash}`);
    expect(body.pull).not.toHaveBeenCalled(); expect(body.cancel).toHaveBeenCalledOnce();
  });
  it("validates blob identity and descriptor metadata before fetching", async () => {
    const { client: api, fetch } = client(streamed([payload]).response);
    await expect(api.eventBlob("..", hash)).rejects.toThrow("bad media session id");
    await expect(api.eventBlob("s", "a".repeat(63))).rejects.toThrow("bad media hash");
    await expect(api.eventBlob("s", hash, { mime: "image/png", size: HISTORY_MEDIA_DESCRIPTOR_MAX_BYTES + 1 })).rejects.toThrow("bad expected media descriptor");
    await expect(api.eventBlob("s", hash, { mime: "image/png", size: 1, url: "https://elsewhere" } as never)).rejects.toThrow("bad expected media descriptor");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("checks the route hash and expected MIME/size for blob bytes", async () => {
    expect(await client(streamed([payload]).response).client.eventBlob("s", "a".repeat(64))).toBeNull();
    expect(await client(streamed([payload]).response).client.eventBlob("s", hash, { mime: "image/jpeg", size: payload.length })).toBeNull();
    expect(await client(streamed([payload]).response).client.eventBlob("s", hash, { mime: "image/png", size: payload.length - 1 })).toBeNull();
  });
});

it("copies tiny reused stream chunks and returns an exact-size byte buffer", async () => {
  const chunk = new Uint8Array(1);
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset === payload.length) { controller.close(); return; }
    chunk[0] = payload[offset++]!;
    controller.enqueue(chunk);
  } }, { highWaterMark: 0 });
  const result = await client(new Response(body, { headers: { "Content-Type": "image/png" } })).client.eventBlob("s", hash);
  expect(result).toEqual({ bytes: payload, mime: "image/png", size: payload.length });
  expect(result!.bytes.buffer.byteLength).toBe(payload.length);
});
