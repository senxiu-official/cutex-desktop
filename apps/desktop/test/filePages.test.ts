// HTML files as pages in the file view (owner 2026-10-24; main/frames.ts prepareFile): main reads the file from
// that host and serves it once as the shared offline, sandboxed document — with NO page channels, after the
// network is contained; inline-only (references to files next to it are counted, never loaded); a size gate.
import { describe, expect, it, vi } from "vitest";
import { createFrameDocumentStore } from "@cutex-desktop/opaque-frame/documents";
import { OFFLINE_PAGE_CSP } from "@cutex-desktop/opaque-frame/page";
import type { FsFile, WorkspaceScope } from "../src/shared/ipc";
import { FILE_PAGE_MAX_BYTES, FILE_PAGE_PROMPT_BYTES } from "../src/shared/frames";
import { countExternalRefs, createArtifactPageService, parseFilePageInput } from "../src/main/frames";

const file = (patch: Partial<FsFile> = {}): FsFile => ({ path: "a.html", size: 60, modifiedAt: "2026-10-24T00:00:00Z", encoding: "utf8", content: "<h1>hi</h1><script>go()</script>", truncated: false, mime: "text/html", ...patch });

function fixture(value: FsFile | Error = file(), connected = true) {
  const documents = createFrameDocumentStore({ scheme: "cutex-plugin" });
  const order: string[] = [];
  const read = async () => {
    if (value instanceof Error) throw value;
    return value;
  };
  const fsFile = vi.fn(async (_scope: WorkspaceScope, _path: string, _max?: number) => read());
  const hostFile = vi.fn(async (_path: string, _max?: number) => read());
  const add = documents.add;
  const service = createArtifactPageService({
    documents: { add: (o, d) => (order.push("add"), add(o, d)), release: documents.release },
    contentReader: () => null,
    ensureContained: async () => void order.push("contained"),
    fileReader: () => (connected ? { fsFile, hostFile } : null),
  });
  return { documents, order, fsFile, hostFile, service };
}

describe("file pages", () => {
  it("serves the host's file once as the offline sandboxed document, without the page API, after containment", async () => {
    const f = fixture();
    const r = await f.service.prepareFile(3, { hostId: "local", path: "D:/x/preview.html" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(f.hostFile).toHaveBeenCalledWith("D:/x/preview.html", FILE_PAGE_PROMPT_BYTES);
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
    expect(f.fsFile).toHaveBeenCalledWith({ kind: "project", id: "proj_1" }, "docs/p.htm", FILE_PAGE_MAX_BYTES);
    expect(f.hostFile).not.toHaveBeenCalled();
  });

  it("refuses what it cannot show, preparing nothing", async () => {
    const cases: [FsFile | Error, boolean, string][] = [
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
    expect(big).toEqual({ ok: false, reason: "too-large", totalBytes: 7 * 1024 * 1024 });
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
