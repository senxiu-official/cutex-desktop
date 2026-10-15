import { Script } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { applyOpaqueFrame, buildOfflinePageDocument, OFFLINE_PAGE_CSP, OFFLINE_PAGE_MAX_BYTES, onFrameNavigatedAway, OPAQUE_FRAME_SANDBOX } from "../src/index";
import { createFrameDocumentStore } from "../src/documents";

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
});
