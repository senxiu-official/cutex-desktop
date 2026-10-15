import { afterEach, describe, expect, it, vi } from "vitest";
import { CutexClient } from "@cutex-desktop/cutex-client";
import { createBrowserOwnerApi } from "../src/main/browser/ownerApi";
import type { BrowserImage } from "../src/main/browser/modelOutput";
import { BrowserRelayError } from "../src/main/browser/relayTypes";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvN8AAAAASUVORK5CYII=";
const image = { type: "image", mimeType: "image/png", data: PNG };
const names = ["browser_list", "browser_read", "browser_find", "browser_act", "browser_navigate", "browser_screenshot", "browser_release", "browser_open", "browser_claim"];
const mcp = (extra: Record<string, unknown> = {}) => ({ id: "item", type: "mcpToolCall", server: "cutex", tool: "browser_screenshot",
  status: "completed", arguments: { title: "View page" }, result: { content: [image] }, ...extra });
const dynamic = (extra: Record<string, unknown> = {}) => ({ id: "item", type: "dynamicToolCall", namespace: "claude", tool: "browser_screenshot",
  contentItems: [{ type: "inputImage", imageUrl: `data:image/png;base64,${PNG}` }], ...extra });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture(body: unknown = { item: mcp() }) {
  const requests: { url: URL; init?: RequestInit }[] = [];
  const respond = vi.fn<() => Response | Promise<Response>>(() => json(body));
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: new URL(String(input)), init }); return await respond();
  });
  const client = new CutexClient({ baseUrl: "http://bound-owner-fixture.test", token: "dummy-owner-token" }, { fetch });
  const decoded: BrowserImage = { isEmpty: vi.fn(() => false), getSize: vi.fn(() => ({ width: 1, height: 1 })),
    resize: vi.fn(() => decoded), toPNG: vi.fn(() => Buffer.from(PNG, "base64")), toJPEG: vi.fn(() => Buffer.alloc(0)) };
  const decodeImage = vi.fn(() => decoded), check = vi.fn();
  const api = createBrowserOwnerApi({ client, decodeImage, check });
  return { api, requests, fetch, respond, decodeImage, decoded, check };
}
afterEach(() => vi.useRealTimers());

describe("browser owner exact-item identity", () => {
  it("accepts only the frozen nine tools from actual MCP/dynamic runtime identities", async () => {
    for (const tool of names) for (const item of [mcp({ tool }), dynamic({ tool }), dynamic({ tool, namespace: "cutex" })]) {
      const f = fixture({ item });
      expect(await f.api.toolItem("session", "turn", "item")).toEqual({ item });
      expect(f.decodeImage).toHaveBeenCalledExactlyOnceWith(Buffer.from(PNG, "base64"));
    }
  });
  it("rejects unknown or spoofed tools before decoding any bytes", async () => {
    for (const item of [mcp({ server: "other" }), mcp({ server: "cutex-extra" }), mcp({ type: "commandExecution" }),
      mcp({ tool: "browser_evaluate" }), mcp({ tool: "read_file" }), mcp({ tool: "browser_read.extra" }),
      dynamic({ namespace: "shell" }), dynamic({ namespace: undefined }), dynamic({ type: "mcpToolCall" })]) {
      const f = fixture({ item });
      await expect(f.api.toolItem("session", "turn", "item")).rejects.toMatchObject({ code: "invalid_result" });
      expect(f.decodeImage).not.toHaveBeenCalled();
    }
  });
  it("requires one exact item, never an item list, another turn, or an extra envelope", async () => {
    for (const value of [{ item: mcp({ id: "other" }) }, { items: [mcp()] }, { item: null }, { item: mcp({ turnId: "other" }) },
      { item: mcp(), thread: { items: [] } }, [mcp()]]) {
      const f = fixture(value);
      await expect(f.api.toolItem("session", "turn", "item")).rejects.toMatchObject({ code: "invalid_result" });
    }
  });
  it("does not return compact/truncated images as full history", async () => {
    for (const item of [mcp({ truncated: true }), dynamic({ truncated: true }),
      mcp({ result: { content: [{ type: "imageNotLoaded", fullItemRequired: true }] } }),
      dynamic({ contentItems: [{ type: "imageNotLoaded", fullItemRequired: true }] }),
      mcp({ result: { content: "not-an-array" } }), mcp({ result: { content: Array(9).fill({ type: "text", text: "" }) } })]) {
      await expect(fixture({ item }).api.toolItem("session", "turn", "item")).rejects.toMatchObject({ code: "invalid_result" });
    }
  });
  it("permits completed text-only or absent-result browser items without an image fetch", async () => {
    for (const item of [mcp({ tool: "browser_read", result: { content: [{ type: "text", text: "dummy" }] } }),
      dynamic({ tool: "browser_act", contentItems: [{ type: "inputText", text: "dummy" }] }), mcp({ result: null })]) {
      const f = fixture({ item }); expect(await f.api.toolItem("session", "turn", "item")).toEqual({ item });
      expect(f.decodeImage).not.toHaveBeenCalled(); expect(f.fetch).toHaveBeenCalledOnce();
    }
  });
});

describe("browser owner full-image validation", () => {
  it("requires the injected full decoder, not just valid PNG header dimensions", async () => {
    for (const fail of ["throw", "empty", "size"] as const) {
      const f = fixture();
      if (fail === "throw") f.decodeImage.mockImplementation(() => { throw Error("private decoder detail"); });
      if (fail === "empty") vi.mocked(f.decoded.isEmpty).mockReturnValue(true);
      if (fail === "size") vi.mocked(f.decoded.getSize).mockReturnValue({ width: 2, height: 1 });
      await expect(f.api.toolItem("session", "turn", "item")).rejects.toMatchObject({ code: "invalid_result", message: "invalid_result" });
      expect(f.decodeImage).toHaveBeenCalledOnce();
    }
  });
  it("also requires full JPEG decoding after a readable SOF header", async () => {
    // Deliberately only a header: the production native decoder must reject it.
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0, 0xff, 0xd9]);
    const f = fixture({ item: dynamic({ contentItems: [{ type: "inputImage", imageUrl: `data:image/jpeg;base64,${bytes.toString("base64")}` }] }) });
    f.decodeImage.mockImplementation(() => { throw Error("incomplete JPEG scan"); });
    await expect(f.api.toolItem("session", "turn", "item")).rejects.toMatchObject({ code: "invalid_result" });
    expect(f.decodeImage).toHaveBeenCalledExactlyOnceWith(bytes);
  });
  it("rejects corrupt framing, oversize and excessive dimensions before native decoding", async () => {
    const wide = Buffer.from(PNG, "base64"); wide.writeUInt32BE(1601, 16);
    for (const bad of [{ ...image, data: PNG.slice(0, -1) }, { ...image, data: PNG + "\n" }, { ...image, data: "AAAA" },
      { ...image, data: "A".repeat(6 * 1024 * 1024 + 4) }, { ...image, mimeType: "image/svg+xml" },
      { ...image, data: wide.toString("base64") }, { type: "image", mimeType: "image/png" }]) {
      const f = fixture({ item: mcp({ result: { content: [bad] } }) });
      await expect(f.api.toolItem("session", "turn", "item")).rejects.toMatchObject({ code: "invalid_result" });
      expect(f.decodeImage).not.toHaveBeenCalled();
    }
  });
  it("never fetches dynamic external/file/SVG image URLs or resource links", async () => {
    for (const imageUrl of ["https://outside.invalid/image.png", "file:///private.png", "blob:private", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,AAAA"]) {
      const f = fixture({ item: dynamic({ contentItems: [{ type: "inputImage", imageUrl }] }) });
      await expect(f.api.toolItem("session", "turn", "item")).rejects.toMatchObject({ code: "invalid_result" });
      expect(f.fetch).toHaveBeenCalledOnce(); expect(f.decodeImage).not.toHaveBeenCalled();
    }
    await expect(fixture({ item: mcp({ result: { content: [{ type: "resource_link", uri: "file:///private" }] } }) })
      .api.toolItem("session", "turn", "item")).rejects.toMatchObject({ code: "invalid_result" });
  });
  it("bounds image count, object depth and node count", async () => {
    let deep: unknown = "end"; for (let index = 0; index < 26; index++) deep = { child: deep };
    for (const item of [mcp({ result: { content: [image, image] } }), mcp({ extra: deep }), mcp({ extra: Array(20_001).fill(0) })])
      await expect(fixture({ item }).api.toolItem("session", "turn", "item")).rejects.toMatchObject({ code: "invalid_result" });
  });
  it("validates B10 bytes identically and does not return private storage fields", async () => {
    const f = fixture({ mimeType: "image/png", data: PNG, path: "private", leaseId: "private" });
    expect(await f.api.turnShot("shot")).toEqual({ mimeType: "image/png", data: PNG });
    expect(f.decodeImage).toHaveBeenCalledExactlyOnceWith(Buffer.from(PNG, "base64"));
  });
});

describe("browser owner bounded fixed-route transport", () => {
  it("exposes only fixed reads on the injected host, without general RPC or mutable request options", async () => {
    const f = fixture();
    expect(Object.keys(f.api).sort()).toEqual(["agents", "clearIdempotency", "profileTools", "settings", "toolItem", "turnShot", "turnShots"]);
    await f.api.toolItem("session:1", "turn.1", "item");
    const [request] = f.requests;
    expect(request!.url.origin).toBe("http://bound-owner-fixture.test");
    expect(request!.url.pathname).toBe("/v2/browser/tool-item");
    expect([...request!.url.searchParams.entries()]).toEqual([["sessionId", "session:1"], ["turnId", "turn.1"], ["itemId", "item"]]);
    expect(request!.init).toMatchObject({ redirect: "error" });
    expect(request!.init?.method ?? "GET").toBe("GET"); expect(request!.init?.body).toBeUndefined();
  });
  it("rejects route/path/query injection before sending anything", async () => {
    const f = fixture();
    for (const bad of ["", "../private", "/v2/threads", "x?all=true", "x#fragment", "https://outside.invalid", "x".repeat(201)]) {
      await expect(f.api.toolItem(bad, "turn", "item")).rejects.toMatchObject({ code: "invalid_request" });
      await expect(f.api.toolItem("session", bad, "item")).rejects.toMatchObject({ code: "invalid_request" });
      await expect(f.api.toolItem("session", "turn", bad)).rejects.toMatchObject({ code: "invalid_request" });
      await expect(f.api.turnShot(bad)).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each([404, 410])("does not resurrect a missing/expired image (%s), retry, or query a generic fallback", async status => {
    const f = fixture(); f.respond.mockImplementation(() => json({ error: { code: "target_closed", message: "private" } }, status));
    await expect(f.api.turnShot("expired")).rejects.toMatchObject({ code: "target_closed" });
    expect(f.fetch).toHaveBeenCalledOnce(); expect(f.decodeImage).not.toHaveBeenCalled();
    expect(f.requests[0]!.url.pathname).toBe("/v2/browser/turn-shots/expired");
  });
  it.each(["busy", "lease_limit", "approval_denied"])("preserves bounded owner %s refusal without exposing details or retrying", async code => {
    const f = fixture(); f.respond.mockReturnValue(json({ error: { code, message: "SECRET ticket http://private/" } }, 409));
    const error = await f.api.turnShot("shot").catch(error => error);
    expect(error).toMatchObject({ code, message: code }); expect(f.fetch).toHaveBeenCalledOnce(); expect(f.decodeImage).not.toHaveBeenCalled();
    expect(JSON.stringify(error)).not.toContain("SECRET");
  });
  it("unknown/oversized non-success replies fail closed instead of exposing raw diagnostics", async () => {
    for (const body of [{ error: { code: "private-server-error", message: "SECRET" } }, { error: { code: "busy", message: "X".repeat(65536) } }]) {
      const f = fixture(); f.respond.mockReturnValue(json(body, 503));
      await expect(f.api.turnShot("shot")).rejects.toMatchObject({ code: "invalid_result" }); expect(f.fetch).toHaveBeenCalledOnce();
    }
  });
  it("fails before fetch on an obsolete bound host and cancels a reply after host replacement", async () => {
    const early = fixture(); early.check.mockImplementation(() => { throw new BrowserRelayError("stale_connection"); });
    await expect(early.api.toolItem("session", "turn", "item")).rejects.toMatchObject({ code: "stale_connection" });
    expect(early.fetch).not.toHaveBeenCalled();
    const late = fixture(), pending = deferred<Response>(), cancel = vi.fn(); late.respond.mockReturnValue(pending.promise);
    const read = late.api.toolItem("session", "turn", "item"), rejected = expect(read).rejects.toMatchObject({ code: "stale_connection" });
    late.check.mockImplementation(() => { throw new BrowserRelayError("stale_connection"); });
    pending.resolve(new Response(new ReadableStream({ cancel }), { headers: { "Content-Type": "application/json" } }));
    await rejected; expect(cancel).toHaveBeenCalledOnce(); expect(late.decodeImage).not.toHaveBeenCalled();
  });
  it("rechecks the host for each response chunk", async () => {
    const f = fixture(), cancel = vi.fn(); let controller!: ReadableStreamDefaultController<Uint8Array>;
    f.respond.mockReturnValue(new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel }), { headers: { "Content-Type": "application/json" } }));
    const read = f.api.toolItem("session", "turn", "item"), rejected = expect(read).rejects.toMatchObject({ code: "stale_connection" });
    await flush(); f.check.mockImplementation(() => { throw new BrowserRelayError("stale_connection"); });
    controller.enqueue(new TextEncoder().encode(JSON.stringify({ item: mcp() })));
    await rejected; expect(cancel).toHaveBeenCalledOnce(); expect(f.decodeImage).not.toHaveBeenCalled();
  });
  it("rejects declared or streamed responses beyond the 8 MiB history budget", async () => {
    const declared = fixture(), cancel = vi.fn();
    declared.respond.mockReturnValue(new Response(new ReadableStream({ cancel }), { headers: { "Content-Type": "application/json", "Content-Length": String(8 * 1024 * 1024 + 1) } }));
    await expect(declared.api.toolItem("session", "turn", "item")).rejects.toMatchObject({ code: "invalid_result" }); expect(cancel).toHaveBeenCalledOnce();
    const streamed = fixture(); streamed.respond.mockReturnValue(new Response(" ".repeat(8 * 1024 * 1024 + 1), { headers: { "Content-Type": "application/json" } }));
    await expect(streamed.api.toolItem("session", "turn", "item")).rejects.toMatchObject({ code: "invalid_result" });
    expect(streamed.decodeImage).not.toHaveBeenCalled();
  });
  it("rejects malformed length, media type, JSON and UTF-8 without raw error details", async () => {
    for (const response of [new Response("{}", { headers: { "Content-Type": "text/plain" } }),
      new Response("{}", { headers: { "Content-Type": "application/json", "Content-Length": "bad" } }),
      new Response("{private", { headers: { "Content-Type": "application/json" } }),
      new Response(new Uint8Array([0xc0, 0xaf]), { headers: { "Content-Type": "application/json" } })]) {
      const f = fixture(); f.respond.mockReturnValue(response);
      await expect(f.api.toolItem("session", "turn", "item")).rejects.toMatchObject({ code: "invalid_result", message: "invalid_result" });
    }
  });
  it("times out stalled bodies and cancels the reader even if fetch ignores AbortSignal", async () => {
    vi.useFakeTimers(); const f = fixture(), cancel = vi.fn();
    f.respond.mockReturnValue(new Response(new ReadableStream({ cancel }), { headers: { "Content-Type": "application/json" } }));
    const read = f.api.toolItem("session", "turn", "item"), rejected = expect(read).rejects.toMatchObject({ code: "browser_unavailable" });
    await flush(); await vi.advanceTimersByTimeAsync(10_000); await rejected;
    expect(cancel).toHaveBeenCalledOnce(); expect(f.requests[0]!.init?.signal?.aborted).toBe(true); expect(f.fetch).toHaveBeenCalledOnce();
  });
  it("cancels a response arriving after timeout without reading or decoding it", async () => {
    vi.useFakeTimers(); const f = fixture(), pending = deferred<Response>(), cancel = vi.fn(); f.respond.mockReturnValue(pending.promise);
    const read = f.api.toolItem("session", "turn", "item"), rejected = expect(read).rejects.toMatchObject({ code: "browser_unavailable" });
    await vi.advanceTimersByTimeAsync(10_000); await rejected;
    pending.resolve(new Response(new ReadableStream({ cancel }), { headers: { "Content-Type": "application/json" } }));
    await flush(); expect(cancel).toHaveBeenCalledOnce(); expect(f.decodeImage).not.toHaveBeenCalled();
  });
  it("validates exact-turn metadata, bounded batch and duplicate IDs", async () => {
    const shot = { id: "shot", turnId: "turn", createdAt: "2026-10-11T10:00:00Z", width: 1, height: 1, mimeType: "image/png" };
    expect(await fixture({ items: [{ ...shot, path: "private" }] }).api.turnShots("session", "turn")).toEqual([shot]);
    expect(await fixture({ items: [] }).api.turnShots("session", "turn")).toEqual([]);
    for (const items of [[{ ...shot, turnId: "other" }], [shot, shot], Array.from({ length: 257 }, (_, index) => ({ ...shot, id: `s${index}` })), [{ ...shot, width: 1601 }]])
      await expect(fixture({ items }).api.turnShots("session", "turn")).rejects.toMatchObject({ code: "invalid_result" });
  });
});

describe("browser owner narrow settings mutations", () => {
  it("clears only the fixed browser idempotency route with a bounded scope", async () => {
    const result = { deleted: 3, outcomeUnknown: 2, abandonedForwarded: 1, scope: "session", warning: "retry may execute again" };
    const f = fixture(result);
    expect(await f.api.clearIdempotency("cutex.agent-1")).toEqual(result);
    expect(f.requests[0]!.url.pathname).toBe("/v2/browser/idempotency/clear");
    expect(f.requests[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(f.requests[0]!.init?.body))).toEqual({ cutexSessionId: "cutex.agent-1" });
    for (const id of ["", "../agent", "agent/name", "x".repeat(201)])
      await expect(f.api.clearIdempotency(id)).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("projects only agentOpenApproval from the real settings view shape", async () => {
    const f = fixture({ contractVersion: 2, browser: { agentOpenApproval: "off", leaseIdleSecs: 30 }, unrelated: { token: "private" } });
    expect(await f.api.settings()).toEqual({ agentOpenApproval: "off" });
    expect(f.requests[0]!.url.pathname).toBe("/v2/settings");
    expect(f.requests[0]!.init?.method).toBe("GET"); expect(f.requests[0]!.init?.body).toBeUndefined();
    f.respond.mockImplementation(() => json({ browser: { agentOpenApproval: "ask" }, changed: true, restartRequired: [] }));
    expect(await f.api.settings("ask")).toEqual({ agentOpenApproval: "ask" });
    expect(f.requests[1]!.init?.method).toBe("PATCH");
    expect(JSON.parse(String(f.requests[1]!.init?.body))).toEqual({ browser: { agentOpenApproval: "ask" } });
    expect(new Headers(f.requests[1]!.init?.headers).get("Content-Type")).toBe("application/json");
  });
  it("uses profile.browserTools, not detail/editable, and safely encodes an exact Unicode name", async () => {
    const profile = "Claude 中文 name#?%2F", f = fixture({ contractVersion: 2,
      profile: { browserTools: false, name: profile, detail: { editable: { browserTools: true } }, unrelated: "private" } });
    expect(await f.api.profileTools(profile)).toEqual({ enabled: false });
    expect(f.requests[0]!.url.pathname).toBe(`/v2/profiles/${encodeURIComponent(profile)}`);
    expect(f.requests[0]!.url.search).toBe(""); expect(f.requests[0]!.url.hash).toBe("");
    f.respond.mockImplementation(() => json({ contractVersion: 2, profile: { browserTools: true, detail: { editable: { browserTools: true } } } }));
    expect(await f.api.profileTools(profile, true)).toEqual({ enabled: true });
    expect(f.requests[1]!.init?.method).toBe("PATCH");
    expect(JSON.parse(String(f.requests[1]!.init?.body))).toEqual({ browserTools: true });
    f.respond.mockImplementation(() => json({ profile: { browserTools: false } }));
    expect(await f.api.profileTools("profile-id", false)).toEqual({ enabled: false });
    expect(JSON.parse(String(f.requests[2]!.init?.body))).toEqual({ browserTools: false });
  });
  it("rejects untyped settings, profile path escapes and broad mutation objects before I/O", async () => {
    const f = fixture();
    for (const value of [null, true, "on", "always", { browser: { agentOpenApproval: "ask" } }])
      await expect(f.api.settings(value as "off")).rejects.toMatchObject({ code: "invalid_request" });
    for (const profile of ["", " ", ".", "..", "../main", "main/duplicate", "main\\private", "main\n", "main\u0085", "x".repeat(201), "\ud800"])
      await expect(f.api.profileTools(profile, true)).rejects.toMatchObject({ code: "invalid_request" });
    for (const enabled of [null, "true", 1, { browserTools: true, apiKey: "private" }])
      await expect(f.api.profileTools("main", enabled as unknown as boolean)).rejects.toMatchObject({ code: "invalid_request" });
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("fails closed when an older daemon lacks the fields or reports nonboolean profile policy", async () => {
    for (const value of [{}, { browser: null }, { browser: { agentOpenApproval: true } }, { browser: { agentOpenApproval: "always" } }])
      await expect(fixture(value).api.settings()).rejects.toMatchObject({ code: "invalid_result" });
    for (const value of [{}, { profile: {} }, { profile: { detail: { browserTools: true } } }, { profile: { browserTools: "true" } }])
      await expect(fixture(value).api.profileTools("main")).rejects.toMatchObject({ code: "invalid_result" });
  });
  it("keeps the 64 KiB budget for settings/profile replies", async () => {
    for (const which of ["settings", "profile"] as const) {
      const f = fixture({ browser: { agentOpenApproval: "off" }, profile: { browserTools: false }, unexpected: "x".repeat(64 * 1024) });
      await expect(which === "settings" ? f.api.settings() : f.api.profileTools("main")).rejects.toMatchObject({ code: "invalid_result" });
      expect(f.fetch).toHaveBeenCalledOnce();
    }
  });
  it("never retries an uncertain PATCH or turns it into an implicit GET", async () => {
    vi.useFakeTimers(); const f = fixture(), pending = deferred<Response>(); f.respond.mockReturnValue(pending.promise);
    const change = f.api.settings("ask"), rejected = expect(change).rejects.toMatchObject({ code: "outcome_unknown" });
    await vi.advanceTimersByTimeAsync(10_000); await rejected;
    expect(f.fetch).toHaveBeenCalledOnce(); expect(f.requests[0]!.init?.method).toBe("PATCH");
    const cancel = vi.fn(); pending.resolve(new Response(new ReadableStream({ cancel }), { headers: { "Content-Type": "application/json" } }));
    await flush(); expect(cancel).toHaveBeenCalledOnce(); expect(f.fetch).toHaveBeenCalledOnce();
  });
  it("fails closed before a PATCH on stale host and refuses stale post-write acknowledgements", async () => {
    const early = fixture(); early.check.mockImplementation(() => { throw new BrowserRelayError("stale_connection"); });
    await expect(early.api.profileTools("main", true)).rejects.toMatchObject({ code: "stale_connection" });
    expect(early.fetch).not.toHaveBeenCalled();
    const late = fixture(), pending = deferred<Response>(); late.respond.mockReturnValue(pending.promise);
    const change = late.api.profileTools("main", true), rejected = expect(change).rejects.toMatchObject({ code: "stale_connection" });
    late.check.mockImplementation(() => { throw new BrowserRelayError("stale_connection"); });
    pending.resolve(json({ profile: { browserTools: true } })); await rejected;
    expect(late.fetch).toHaveBeenCalledOnce();
  });
});
