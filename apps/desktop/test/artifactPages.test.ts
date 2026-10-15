// Agent pages in main (main/frames.ts, docs/desktop-modules.md §10.2): host bytes → one-use offline
// document in the shared frame store; nothing served before the network is contained.
import { describe, expect, it, vi } from "vitest";
import { createFrameDocumentStore } from "@cutex-desktop/opaque-frame/documents";
import { OFFLINE_PAGE_CSP } from "@cutex-desktop/opaque-frame/page";
import type { ArtifactContent } from "../src/shared/artifactStore";
import { createArtifactPageService, parseArtifactPageInput } from "../src/main/frames";

const ID = "af-0123456789abcdef0123456789abcdef";
const content = (patch: Partial<ArtifactContent> = {}): ArtifactContent => ({ version: 2, encoding: "utf8", content: "<canvas></canvas><script>draw()</script>", offset: 0, totalBytes: 40, truncated: false, mediaType: "text/html", sha256: null, externalChanged: null, ...patch });
function fixture(value: ArtifactContent | null = content(), connected = true) {
  const documents = createFrameDocumentStore({ scheme: "cutex-plugin" });
  const read = vi.fn(async () => value);
  const order: string[] = [];
  const ensureContained = vi.fn(async () => void order.push("contained"));
  const add = documents.add;
  const service = createArtifactPageService({ documents: { add: (o, d) => (order.push("add"), add(o, d)), release: documents.release }, contentReader: () => (connected ? { artifactStoreContent: read } : null), ensureContained });
  return { documents, read, ensureContained, order, service };
}

describe("agent pages", () => {
  it("serves the host's bytes once as an offline, sandboxed document after containment", async () => {
    const f = fixture();
    const r = await f.service.prepare(7, { hostId: "local", artifactId: ID, version: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(f.read).toHaveBeenCalledWith(ID, 2, { maxBytes: 4 * 1024 * 1024 });
    expect(f.order).toEqual(["contained", "add"]);
    expect(f.documents.ownsUrl(r.frame.url, 7)).toBe(true);
    expect(f.documents.ownsUrl(r.frame.url, 8)).toBe(false);
    const response = f.documents.respond(new Request(r.frame.url));
    expect(response.headers.get("content-security-policy")).toBe(`${OFFLINE_PAGE_CSP}; sandbox allow-scripts`);
    const html = await response.text();
    expect(html).toContain("<script>draw()</script>");
    expect(html).not.toContain("sandboxBridge");
    f.service.release(7, r.frame.id);
    expect(f.documents.ownsUrl(r.frame.url, 7)).toBe(false);
  });
  it("refuses what it cannot show as a page, without preparing anything", async () => {
    const cases: [ArtifactContent | null, string][] = [
      [null, "not-found"],
      [content({ version: 3 }), "not-found"],
      [content({ encoding: "base64" }), "not-text"],
      [content({ truncated: true }), "too-large"],
      [content({ externalChanged: true, content: "" }), "external-changed"],
    ];
    for (const [value, reason] of cases) {
      const f = fixture(value);
      expect(await f.service.prepare(1, { hostId: "local", artifactId: ID, version: 2 })).toEqual({ ok: false, reason });
      expect(f.order).toEqual([]);
    }
    expect(await fixture(content(), false).service.prepare(1, { hostId: "x", artifactId: ID, version: 2 })).toEqual({ ok: false, reason: "host-offline" });
  });
  it("accepts only host + artifact id + concrete version from the renderer", () => {
    expect(parseArtifactPageInput({ hostId: "h", artifactId: ID, version: 1 })).toEqual({ hostId: "h", artifactId: ID, version: 1 });
    for (const bad of [{ hostId: "h", artifactId: ID, version: "latest" }, { hostId: "h", artifactId: "af-1", version: 1 }, { hostId: "", artifactId: ID, version: 1 }, { hostId: "h", artifactId: ID, version: 1, html: "<p>" }, null, []]) {
      expect(() => parseArtifactPageInput(bad)).toThrow("Invalid artifact page request");
    }
  });
});
