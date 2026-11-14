// HTML files as pages in the file view (owner 2026-10-24; main/frames.ts prepareFile): main reads the file from
// that host and serves it once as the shared offline, sandboxed document — with NO page channels, after the
// network is contained; inline-only (references to files next to it are counted, never loaded); a size gate.
// Large files (owner 2026-11-14): read in windows (cutex fs-file-window) up to the artifact page bound.
import { describe, expect, it, vi } from "vitest";
import { createFrameDocumentStore } from "@cutex-desktop/opaque-frame/documents";
import { OFFLINE_PAGE_CSP } from "@cutex-desktop/opaque-frame/page";
import type { WorkspaceScope } from "../src/shared/ipc";
import { ARTIFACT_PAGE_MAX_BYTES, FILE_PAGE_MAX_BYTES, FILE_PAGE_PROMPT_BYTES, FILE_PAGE_WINDOW_BYTES } from "../src/shared/frames";
import { countExternalRefs, createArtifactPageService, parseFilePageInput, type FileWindow } from "../src/main/frames";
import { bigPage, cutexFileWindow, MiB } from "./helpers/cutexFileWindow";

const file = (patch: Partial<FileWindow> = {}): FileWindow => ({ path: "a.html", size: 60, modifiedAt: "2026-10-24T00:00:00Z", encoding: "utf8", content: "<h1>hi</h1><script>go()</script>", truncated: false, mime: "text/html", offset: 0, revision: "60:1", ...patch });

function fixture(value: FileWindow | Error | ((offset: number, maxBytes: number) => FileWindow) = file(), connected = true) {
  const documents = createFrameDocumentStore({ scheme: "cutex-plugin" });
  const order: string[] = [];
  const fileWindow = vi.fn(async (_scope: WorkspaceScope | undefined, _path: string, offset: number, maxBytes: number) => {
    if (value instanceof Error) throw value;
    return typeof value === "function" ? value(offset, maxBytes) : value;
  });
  const add = documents.add;
  const service = createArtifactPageService({
    documents: { add: (o, d) => (order.push("add"), add(o, d)), release: documents.release },
    contentReader: () => null,
    ensureContained: async () => void order.push("contained"),
    fileReader: () => (connected ? { fileWindow } : null),
  });
  return { documents, order, fileWindow, service };
}

describe("file pages", () => {
  it("serves the host's file once as the offline sandboxed document, without the page API, after containment", async () => {
    const f = fixture();
    const r = await f.service.prepareFile(3, { hostId: "local", path: "D:/x/preview.html" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(f.fileWindow).toHaveBeenCalledWith(undefined, "D:/x/preview.html", 0, FILE_PAGE_PROMPT_BYTES);
    expect(f.order).toEqual(["contained", "add"]);
    expect(r.externalRefs).toBe(0);
    const response = f.documents.respond(new Request(r.frame.url));
    expect(response.headers.get("content-security-policy")).toBe(`${OFFLINE_PAGE_CSP}; sandbox allow-scripts`);
    const html = await response.text();
    expect(html).toContain("<script>go()</script>");
    expect(html).toContain(`content="${OFFLINE_PAGE_CSP}"`);
    expect(html).not.toContain("cutex-page/1");
    expect(html).not.toContain("cutexPage");
    // One use: the bytes are never served twice.
    expect(f.documents.respond(new Request(r.frame.url)).status).not.toBe(200);
    // No page channel is bound to a file page.
    expect(await f.service.page(3, r.frame.id, { op: "storage.keys" })).toEqual({ ok: false, error: "unavailable" });
    f.service.release(3, r.frame.id);
    expect(f.documents.ownsUrl(r.frame.url, 3)).toBe(false);
  });

  it("reads a workspace path through the workspace route, and the large read only when asked", async () => {
    const f = fixture();
    await f.service.prepareFile(3, { hostId: "h1", path: "docs/p.htm", scope: { kind: "project", id: "proj_1" }, large: true });
    expect(f.fileWindow).toHaveBeenCalledWith({ kind: "project", id: "proj_1" }, "docs/p.htm", 0, FILE_PAGE_WINDOW_BYTES);
    expect(f.fileWindow).toHaveBeenCalledTimes(1);
  });

  it("has the same bound as an artifact page", () => {
    expect(FILE_PAGE_MAX_BYTES).toBe(ARTIFACT_PAGE_MAX_BYTES);
    expect(FILE_PAGE_MAX_BYTES).toBe(256 * MiB);
  });

  it("10–256 MiB (the owner's 11.3 MiB page, a 30 MiB one): asks first, then reads it in windows and serves the whole page", async () => {
    for (const size of [Math.round(11.3 * MiB), 30 * MiB]) {
      const bytes = bigPage(size);
      const scope = { kind: "project" as const, id: "proj_1" };
      const f = fixture((offset, max) => cutexFileWindow(bytes, offset, max));
      const ask = await f.service.prepareFile(3, { hostId: "h1", path: "review/grow-wide.html", scope });
      expect(ask).toEqual({ ok: false, reason: "too-large", totalBytes: bytes.length, modifiedAt: "2026-11-14T00:00:00Z", maxBytes: FILE_PAGE_MAX_BYTES });
      expect(f.order).toEqual([]);
      const r = await f.service.prepareFile(3, { hostId: "h1", path: "review/grow-wide.html", scope, large: true });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const reads = f.fileWindow.mock.calls.slice(1);
      expect(reads[0]![2]).toBe(0);
      expect(reads.length).toBe(Math.ceil(bytes.length / FILE_PAGE_WINDOW_BYTES));
      for (const c of reads) expect([c[0], c[1], c[3]]).toEqual([scope, "review/grow-wide.html", FILE_PAGE_WINDOW_BYTES]);
      expect(f.order).toEqual(["contained", "add"]);
      const html = await f.documents.respond(new Request(r.frame.url)).text();
      expect(html).toContain(`content="${OFFLINE_PAGE_CSP}"`);
      expect(html).not.toContain("cutexPage");
      // Byte-exact: every window boundary fell on a whole character.
      expect(html.endsWith(bytes.toString("utf8").replace(/^<!doctype html>/i, ""))).toBe(true);
    }
  });

  it("over 256 MiB: source only, even when asked; nothing is read past the first window", async () => {
    const head = bigPage(1024);
    const f = fixture((offset, max) => cutexFileWindow(head, offset, max, { size: 300 * MiB }));
    for (const large of [false, true]) {
      const r = await f.service.prepareFile(3, { hostId: "local", path: "/p/huge.html", ...(large ? { large } : {}) });
      expect(r).toMatchObject({ ok: false, reason: "too-large", totalBytes: 300 * MiB, maxBytes: FILE_PAGE_MAX_BYTES });
    }
    expect(f.fileWindow.mock.calls.map((c) => c[2])).toEqual([0, 0]);
    expect(f.order).toEqual([]);
  });

  it("an older cutex (no fs-file-window: offset not echoed) keeps one read: over 10 MiB source only", async () => {
    const bytes = bigPage(11 * MiB);
    const f = fixture((offset, max) => cutexFileWindow(bytes, offset, max, { windowed: false }));
    expect(await f.service.prepareFile(3, { hostId: "local", path: "/p/a.html" })).toMatchObject({ ok: false, reason: "too-large", maxBytes: FILE_PAGE_WINDOW_BYTES });
    expect(await f.service.prepareFile(3, { hostId: "local", path: "/p/a.html", large: true })).toMatchObject({ ok: false, reason: "too-large", maxBytes: FILE_PAGE_WINDOW_BYTES });
    expect(f.fileWindow).toHaveBeenCalledTimes(2);
    // 5–10 MiB still shows after the prompt, in its one read.
    const mid = bigPage(7 * MiB);
    const g = fixture((offset, max) => cutexFileWindow(mid, offset, max, { windowed: false }));
    expect((await g.service.prepareFile(3, { hostId: "local", path: "/p/a.html", large: true })).ok).toBe(true);
  });

  it("a file that changes while it is read, a bad window or a failed read prepares nothing", async () => {
    const bytes = bigPage(12 * MiB);
    const bad: ((offset: number, max: number) => FileWindow)[] = [
      (o, m) => cutexFileWindow(bytes, o, m, { modifiedAt: o === 0 ? "t0" : "t1" }),
      // A same-size rewrite that only the full-precision revision shows.
      (o, m) => cutexFileWindow(bytes, o, m, { revision: o === 0 ? "r0" : "r1" }),
      (o, m) => cutexFileWindow(bytes, o, m, { size: o === 0 ? bytes.length : bytes.length + 1 }),
      (o, m) => (o === 0 ? cutexFileWindow(bytes, o, m) : { ...cutexFileWindow(bytes, o, m), offset: o + 1 }),
      (o, m) => (o === 0 ? cutexFileWindow(bytes, o, m) : { ...cutexFileWindow(bytes, o, m), content: "" }),
      (o, m) => (o === 0 ? cutexFileWindow(bytes, o, m) : { ...cutexFileWindow(bytes, o, m), truncated: false, content: "x" }),
      (o, m) => {
        if (o > 0) throw new Error("path_not_found");
        return cutexFileWindow(bytes, o, m);
      },
    ];
    for (const read of bad) {
      const f = fixture(read);
      expect(await f.service.prepareFile(3, { hostId: "local", path: "/p/a.html", large: true })).toEqual({ ok: false, reason: "not-found" });
      expect(f.order).toEqual([]);
    }
    const binary = fixture((o, m) => (o === 0 ? cutexFileWindow(bytes, o, m) : { ...cutexFileWindow(bytes, o, m), encoding: "base64" }));
    expect(await binary.service.prepareFile(3, { hostId: "local", path: "/p/a.html", large: true })).toEqual({ ok: false, reason: "not-text" });
  });

  it("the first window must echo the offset 0 it was asked for; none = an older cutex", async () => {
    for (const offset of [1, 5, -1]) {
      const f = fixture(file({ offset, size: 5, content: "hello" }));
      expect(await f.service.prepareFile(3, { hostId: "local", path: "/p/a.html" })).toEqual({ ok: false, reason: "not-found" });
      expect(f.order).toEqual([]);
    }
    const legacy = fixture(file({ offset: undefined, revision: undefined }));
    expect((await legacy.service.prepareFile(3, { hostId: "local", path: "/p/a.html" })).ok).toBe(true);
  });

  it("one large page is assembled at a time; a failed one does not block the next", async () => {
    const bytes = bigPage(21 * MiB);
    let active = 0, most = 0, fail = true;
    const f = fixture((o, m) => cutexFileWindow(bytes, o, m));
    f.fileWindow.mockImplementation(async (_s, _p, offset, max) => {
      // Only the later windows count: each run's first read (the size check) happens before it queues.
      const later = offset > 0;
      if (later) active++;
      most = Math.max(most, active);
      await new Promise((r) => setTimeout(r, 5));
      if (later) active--;
      if (offset > 0 && fail) {
        fail = false;
        throw new Error("path_not_found");
      }
      return cutexFileWindow(bytes, offset, max);
    });
    const runs = await Promise.all([0, 1, 2].map(() => f.service.prepareFile(3, { hostId: "local", path: "/p/a.html", large: true })));
    expect(runs.map((r) => r.ok)).toEqual([false, true, true]);
    expect(most).toBe(1);
  });

  it("serves a large page as streamed byte chunks: head, then the page without its doctype", async () => {
    // A BOM, spaces and the page's own doctype (bigPage's first 15 bytes are its doctype, dropped here).
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("  <!DOCTYPE html>"), bigPage(11 * MiB).subarray(15)]);
    const f = fixture((o, m) => cutexFileWindow(bytes, o, m));
    const r = await f.service.prepareFile(3, { hostId: "local", path: "/p/a.html", large: true });
    if (!r.ok) throw new Error(r.reason);
    const reader = f.documents.respond(new Request(r.frame.url)).body!.getReader();
    const sizes: number[] = [];
    const parts: Uint8Array[] = [];
    for (let x = await reader.read(); !x.done; x = await reader.read()) (sizes.push(x.value.byteLength), parts.push(x.value));
    expect(sizes.length).toBe(3); // head + two windows
    const html = Buffer.concat(parts).toString("utf8");
    expect(html.startsWith("<!doctype html><meta charset=\"utf-8\">")).toBe(true);
    expect(html.endsWith(bigPage(11 * MiB).toString("utf8").replace(/^<!doctype html>/i, ""))).toBe(true);
    expect(html.match(/<!doctype/gi)!.length).toBe(1);
  });

  it("refuses what it cannot show, preparing nothing", async () => {
    const cases: [FileWindow | Error, boolean, string][] = [
      [file(), false, "host-offline"],
      [new Error("path_not_found"), true, "not-found"],
      [file({ encoding: "base64" }), true, "not-text"],
      [file({ truncated: true, size: 7 * 1024 * 1024 }), true, "too-large"],
    ];
    for (const [value, connected, reason] of cases) {
      const f = fixture(value, connected);
      const r = await f.service.prepareFile(3, { hostId: "local", path: "/p/a.html" });
      expect(r).toMatchObject({ ok: false, reason });
      expect(f.order).toEqual([]);
    }
    const big = await fixture(file({ truncated: true, size: 7 * 1024 * 1024 })).service.prepareFile(3, { hostId: "local", path: "/p/a.html" });
    expect(big).toEqual({ ok: false, reason: "too-large", totalBytes: 7 * 1024 * 1024, modifiedAt: "2026-10-24T00:00:00Z", maxBytes: FILE_PAGE_MAX_BYTES });
  });

  it("checks the request: only .html / .htm, known keys, a valid scope", () => {
    expect(parseFilePageInput({ hostId: "local", path: "a.HTML" })).toEqual({ hostId: "local", path: "a.HTML" });
    for (const bad of [
      { hostId: "local", path: "a.js" },
      { hostId: "local", path: "a.html", extra: 1 },
      { hostId: "", path: "a.html" },
      { hostId: "local", path: "a\u0000.html" },
      { hostId: "local", path: "a.html", scope: { kind: "host", id: "x" } },
      { hostId: "local", path: "a.html", scope: { kind: "project", id: "../x y" } },
      { hostId: "local", path: "a.html", large: "yes" },
      null,
      "a.html",
    ])
      expect(() => parseFilePageInput(bad), JSON.stringify(bad)).toThrow();
  });

  it("counts what an inline-only page would miss: files next to it and the network, not data: / links / fragments", () => {
    expect(countExternalRefs(`<img src="data:image/png;base64,AA"><a href="other.html">x</a><a href="#top">t</a><style>.a{background:url(data:x)}</style>`)).toBe(0);
    expect(countExternalRefs(`<link rel="stylesheet" href="style.css"><img src='img/a.png'><script src=https://cdn.x/y.js></script><div style="background:url(bg.jpg)"></div><img srcset="a.png 1x, b.png 2x">`)).toBe(6);
  });
});
