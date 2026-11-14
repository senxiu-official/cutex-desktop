import { Script } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { applyOpaqueFrame, buildOfflinePageDocument, OFFLINE_PAGE_CSP, OFFLINE_PAGE_MAX_BYTES, onFrameNavigatedAway, OPAQUE_FRAME_SANDBOX } from "../src/index";
import { createFrameDocumentStore } from "../src/documents";
import { buildOfflinePageChunks, PAGE_API_SCRIPT, PAGE_API_TAG } from "../src/page";

describe("opaque frame attributes", () => {
  it("allows scripts only: no same-origin, popups, forms, top navigation; no device / clipboard access", () => {
    const attrs = new Map<string, string>();
    const frame = applyOpaqueFrame({ title: "", setAttribute: (k: string, v: string) => void attrs.set(k, v) }, "doodle.html");
    expect(frame.title).toBe("doodle.html");
    expect(attrs.get("sandbox")).toBe("allow-scripts");
    expect(OPAQUE_FRAME_SANDBOX.split(/\s+/)).toEqual(["allow-scripts"]);
    expect(attrs.get("referrerpolicy")).toBe("no-referrer");
    for (const feature of ["camera", "microphone", "geolocation", "clipboard-read", "clipboard-write", "fullscreen", "payment"]) expect(attrs.get("allow")).toContain(`${feature} 'none'`);
  });
  it("reports a second load (the page navigated itself) once", () => {
    const target = new EventTarget(), navigated = vi.fn();
    const off = onFrameNavigatedAway(target as unknown as HTMLIFrameElement, navigated);
    target.dispatchEvent(new Event("load"));
    expect(navigated).not.toHaveBeenCalled();
    target.dispatchEvent(new Event("load"));
    target.dispatchEvent(new Event("load"));
    expect(navigated).toHaveBeenCalledOnce();
    off();
  });
});

describe("offline agent page", () => {
  it("has no network source at all, loopback included, and no eval", () => {
    const directives = new Map(OFFLINE_PAGE_CSP.split("; ").map((d) => [d.split(" ")[0]!, d.split(" ").slice(1)] as const));
    expect(directives.get("default-src")).toEqual(["'none'"]);
    expect(directives.get("connect-src")).toEqual(["'none'"]);
    for (const sources of directives.values()) for (const source of sources) expect(["'none'", "'unsafe-inline'", "data:", "blob:"]).toContain(source);
    expect(OFFLINE_PAGE_CSP).not.toMatch(/https?:|ws:|localhost|127\.0\.0\.1|\*|'self'|unsafe-eval/);
    for (const name of ["object-src", "frame-src", "worker-src", "base-uri", "form-action"]) expect(directives.get(name)).toEqual(["'none'"]);
  });
  it("puts the policy before the page and drops the page's own doctype", () => {
    const page = "﻿<!DOCTYPE html><html><head><title>t</title></head><body><canvas></canvas><script>draw()</script></body></html>";
    const { html, csp } = buildOfflinePageDocument(page);
    expect(csp).toBe(OFFLINE_PAGE_CSP);
    expect(html.startsWith('<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<canvas>"));
    expect(html.match(/<!doctype/gi)).toHaveLength(1);
    expect(html).toContain("<script>draw()</script>");
    expect(html).not.toContain("sandboxBridge");
  });
  it("removes WebRTC and WebTransport constructors before the page's scripts", () => {
    const { html } = buildOfflinePageDocument("<p>x</p>");
    const bootstrap = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
    const window: Record<string, unknown> = { RTCPeerConnection() {}, webkitRTCPeerConnection() {}, WebTransport() {}, fetch() {} };
    new Script(bootstrap).runInNewContext({ window, Object });
    expect(Object.keys(window)).toEqual(["fetch"]);
  });
  it("refuses pages over the size limit", () => {
    expect(() => buildOfflinePageDocument("x".repeat(OFFLINE_PAGE_MAX_BYTES + 1))).toThrow("too large");
  });
  it("as byte chunks: the same document bytes as the string form, the page's own chunks kept, the bound checked", () => {
    const enc = new TextEncoder();
    const join = (parts: Uint8Array[]) => Buffer.concat(parts).toString("utf8");
    for (const page of ["<p>é</p>", "﻿ \n<!DOCTYPE html><p>x</p>", "  <!doctype html", "<!doctypeX><p>y</p>", "", "<p>中文 𝄞</p>"]) {
      for (const pageApi of [false, true]) {
        // A second chunk cut off near the end (a window edge; the lead is in the first one, as a 10 MiB window holds it).
        const bytes = enc.encode(page);
        const cut = Math.max(0, bytes.length - 2);
        const chunks = buildOfflinePageChunks([bytes.subarray(0, cut), bytes.subarray(cut)], 1024, { pageApi });
        expect(join(chunks.html), JSON.stringify(page)).toBe(buildOfflinePageDocument(page, 1024, { pageApi }).html);
        expect(chunks.csp).toBe(OFFLINE_PAGE_CSP);
      }
    }
    const body = enc.encode("<p>kept as is</p>");
    expect(buildOfflinePageChunks([body], 1024).html[1]!.buffer).toBe(body.buffer);
    expect(() => buildOfflinePageChunks([new Uint8Array(6)], 5)).toThrow("too large");
    expect(() => buildOfflinePageChunks(["x" as unknown as Uint8Array], 5)).toThrow("bytes");
  });
});

describe("one-use frame documents", () => {
  const doc = { html: "<p>page</p>", csp: OFFLINE_PAGE_CSP };
  it("serves a document once, with its CSP and the sandbox, and keeps the owner's lease until released", async () => {
    const store = createFrameDocumentStore({ scheme: "cutex-plugin" });
    const prepared = store.add(1, doc);
    expect(prepared.url).toMatch(/^cutex-plugin:\/\/frame\/[a-f0-9-]{36}\/index\.html$/);
    expect(store.ownsUrl(prepared.url, 1)).toBe(true);
    expect(store.ownsUrl(prepared.url, 2)).toBe(false);
    const response = store.respond(new Request(prepared.url));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBe(`${OFFLINE_PAGE_CSP}; sandbox allow-scripts`);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe("<p>page</p>");
    expect(store.respond(new Request(prepared.url)).status).toBe(404);
    expect(store.ownsUrl(prepared.url, 1)).toBe(true);
    store.release(2, prepared.id);
    expect(store.ownsUrl(prepared.url, 1)).toBe(true);
    store.release(1, prepared.id);
    expect(store.ownsUrl(prepared.url, 1)).toBe(false);
  });
  it("refuses documents without a default-src 'none' policy, URL variants and limits", () => {
    let now = 0;
    const store = createFrameDocumentStore({ scheme: "cutex-plugin", now: () => now, limitMessage: "Too many x" });
    expect(() => store.add(1, { html: "", csp: "script-src *" })).toThrow("Invalid frame document");
    const first = store.add(1, doc);
    for (const url of [first.url + "?q", first.url.replace("frame/", "other/"), first.url.replace("cutex-plugin", "https")]) expect(store.respond(new Request(url)).status).toBe(404);
    for (let i = 1; i < 8; i++) store.add(1, doc);
    expect(() => store.add(1, doc)).toThrow("Too many x");
    expect(() => store.add(2, doc)).not.toThrow();
    now += 30_001;
    expect(store.respond(new Request(first.url)).status).toBe(404);
    expect(() => store.add(1, doc)).not.toThrow();
  });
  it("streams a chunked document once, chunk by chunk, and refuses chunks that are not bytes", async () => {
    const store = createFrameDocumentStore({ scheme: "cutex-plugin" });
    const enc = new TextEncoder();
    const parts = [enc.encode("<p>a"), enc.encode("b</p>")];
    const prepared = store.add(1, { html: parts, csp: OFFLINE_PAGE_CSP });
    parts.length = 0; // the store keeps its own list
    const response = store.respond(new Request(prepared.url));
    expect(response.headers.get("content-security-policy")).toBe(`${OFFLINE_PAGE_CSP}; sandbox allow-scripts`);
    const reader = response.body!.getReader();
    const got: string[] = [];
    for (let x = await reader.read(); !x.done; x = await reader.read()) got.push(new TextDecoder().decode(x.value));
    expect(got).toEqual(["<p>a", "b</p>"]);
    expect(store.respond(new Request(prepared.url)).status).toBe(404);
    expect(() => store.add(1, { html: ["<p>" as unknown as Uint8Array], csp: OFFLINE_PAGE_CSP })).toThrow("Invalid frame document");
  });
});

describe("page API (window.cutexPage)", () => {
  // A fake frame window: parent receives posts; replies come back as message events from `parent`.
  function run(framed = true) {
    const listeners: ((e: { source: unknown; data: unknown }) => void)[] = [];
    const posted: { data: Record<string, unknown>; target: string }[] = [];
    const parent = { postMessage: (data: Record<string, unknown>, target: string) => posted.push({ data, target }) };
    const window: Record<string, unknown> = {};
    window.parent = framed ? parent : window;
    const context = { window, Object, Map, Promise, JSON, Error, String, setTimeout, clearTimeout, addEventListener: (_t: string, l: (e: { source: unknown; data: unknown }) => void) => listeners.push(l) };
    new Script(PAGE_API_SCRIPT).runInNewContext(context);
    const reply = (data: Record<string, unknown>, source: unknown = parent) => listeners.forEach((l) => l({ source, data: { tag: PAGE_API_TAG, ...data } }));
    return { api: window.cutexPage as { storage: Record<string, (...a: unknown[]) => Promise<unknown>>; submit(c: unknown): Promise<unknown>; copy(t: string): Promise<void> } | undefined, posted, reply };
  }
  it("is absent outside a frame (pages fall back)", () => expect(run(false).api).toBeUndefined());
  it("posts fixed-schema messages to its parent and resolves on the parent's reply only", async () => {
    const { api: maybe, posted, reply } = run();
    const api = maybe!;
    expect(Object.isFrozen(api)).toBe(true);
    const got = api.storage.get("form");
    expect(posted[0]).toEqual({ data: { tag: PAGE_API_TAG, id: 1, op: "storage.get", key: "form" }, target: "*" });
    reply({ re: 1, ok: true, value: '{"a":1}' }, {}); // not from the parent: ignored
    reply({ re: 1, ok: true, value: '{"a":1}' });
    expect(await got).toEqual({ a: 1 });
    api.storage.set("form", { a: 2 });
    expect(posted[1]!.data).toEqual({ tag: PAGE_API_TAG, id: 2, op: "storage.set", key: "form", value: '{"a":2}' });
    const sent = api.submit({ answers: [1] });
    expect(posted[2]!.data).toMatchObject({ op: "submit", format: "json" });
    reply({ re: 3, ok: true, sent: true });
    expect(await sent).toEqual({ sent: true });
    const copy = api.copy("x");
    reply({ re: 4, ok: false, error: "no_gesture" });
    await expect(copy).rejects.toMatchObject({ code: "no_gesture" });
  });
  it("is only in documents built with pageApi", () => {
    expect(buildOfflinePageDocument("<p>x</p>").html).not.toContain("cutexPage");
    const { html, csp } = buildOfflinePageDocument("<p>x</p>", undefined, { pageApi: true });
    expect(html).toContain("cutexPage");
    expect(csp).toBe(OFFLINE_PAGE_CSP);
  });
});
