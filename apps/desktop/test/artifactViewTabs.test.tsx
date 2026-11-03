// @vitest-environment jsdom
// The artifact view's tab row for versions stored by an older cutex with a generic media type
// (an owner label without an extension as the name): the source path's extension types them, so an
// HTML page gets 预览 · 源代码 · 出处 · 对比 and a PDF / JPEG is not shown as text / "cannot preview".
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { ArtifactDetail, ArtifactVersion } from "../src/shared/artifactStore";

vi.mock("../src/renderer/src/bridge", () => ({
  api: { openExternal: () => Promise.resolve() },
  bridge: { on: () => () => {} },
  onEvent: () => () => {},
  cleanIpcMessage: (m: string) => m,
}));

vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));

vi.mock("../src/renderer/src/modules/artifacts/store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadContent: vi.fn(() => new Promise(() => {})),
  loadDiff: () => new Promise(() => {}),
}));
vi.mock("../src/renderer/src/modules/artifacts/PageFrame", () => ({ PageFrame: () => h("div", { "data-testid": "page-frame" }) }));
vi.mock("../src/renderer/src/components/DocumentPreview", () => ({ DocumentPreview: ({ name }: { name: string }) => h("div", { "data-testid": "document", "data-name": name }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ViewBody } = await import("../src/renderer/src/modules/artifacts/View");
const { useArtifactCache } = await import("../src/renderer/src/modules/artifacts/store");
const { loadContent } = await import("../src/renderer/src/modules/artifacts/store");
const { largeRenderChoices, LARGE_RENDER_TTL_MS } = await import("../src/renderer/src/lib/largeRenderChoices");

const ID = "af-0123456789abcdef0123456789abcdef";
const HOST = "local";

function version(mediaType: string, sourcePath: string): ArtifactVersion {
  return {
    artifactId: ID,
    version: 1,
    ref: `${ID}@1`,
    link: `cutex:artifact/${ID}@1`,
    storage: "blob",
    sha256: "x",
    bytes: 120,
    mediaType,
    sourcePath,
    note: null,
    producer: { kind: "owner" },
    git: null,
    createdAt: "2026-10-10T01:00:00Z",
  } as ArtifactVersion;
}

function renderView(name: string, mediaType: string, sourcePath: string): string {
  const v = version(mediaType, sourcePath);
  const detail: ArtifactDetail = {
    artifact: {
      artifactId: ID,
      scope: { kind: "project", id: "p" },
      name,
      kind: "other",
      latestVersion: 1,
      revision: 1,
      starred: false,
      archivedAt: null,
      createdAt: "2026-10-10T00:00:00Z",
      updatedAt: "2026-10-10T00:00:00Z",
      latest: v,
    },
    versions: [v],
  };
  useArtifactCache.setState({ details: { [`${HOST}|${ID}`]: detail }, errors: {} });
  const props = { instance: { id: "t", state: { ref: `${ID}@latest`, pane: "preview" } }, hostId: HOST, setState: () => {}, open: () => {} };
  const host = document.createElement("div");
  const root = createRoot(host);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a minimal SideBodyProps
  act(() => root.render(h(ViewBody, props as any)));
  const html = host.innerHTML;
  act(() => root.unmount());
  return html;
}

const tabs = (html: string) => [...html.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]);

describe("artifact view tabs with a generic stored media type", () => {
  it("remounts an accepted large page without asking; a new version, changed bytes/hash and TTL expiry ask again", async () => {
    largeRenderChoices.clear();
    renderView("large.html", "text/html", "/w/large.html");
    const initial = useArtifactCache.getState().details[`${HOST}|${ID}`]!;
    let v = { ...initial.versions[0]!, bytes: 7 * 1024 * 1024 };
    const update = () => act(() => useArtifactCache.setState({ details: { [`${HOST}|${ID}`]: { ...initial, artifact: { ...initial.artifact, latestVersion: v.version, latest: v }, versions: [v] } } }));
    vi.mocked(loadContent).mockResolvedValue({ artifactId: ID, version: 1, encoding: "utf8", content: "<h1>large page source</h1>", totalBytes: v.bytes, truncated: true } as never);
    update();
    const host = document.createElement("div"), root = createRoot(host);
    const props = { instance: { id: "t", state: { ref: `${ID}@latest`, pane: "preview" } }, hostId: HOST, setState: () => {}, open: () => {} };
    const render = () => act(async () => root.render(h(ViewBody, props as never)));
    const remount = async () => { await act(async () => root.render(null)); await render(); };
    const gate = () => [...host.querySelectorAll("button")].find(b => b.textContent?.includes("artifacts.page.showLarge"));
    const accept = async () => { await vi.waitFor(() => expect(gate()).toBeDefined()); await act(async () => gate()!.click()); expect(host.querySelector('[data-testid="page-frame"]')).not.toBeNull(); };
    try {
      await render(); await accept();
      await remount();
      expect(gate()).toBeUndefined();
      expect(host.querySelector('[data-testid="page-frame"]')).not.toBeNull();
      for (const patch of [{ version: 2 }, { bytes: v.bytes + 1 }, { sha256: "changed" }]) {
        v = { ...v, ...patch }; update(); await accept();
      }
      const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + LARGE_RENDER_TTL_MS + 1);
      try { await remount(); await vi.waitFor(() => expect(gate()).toBeDefined()); } finally { clock.mockRestore(); }
    } finally { act(() => root.unmount()); vi.mocked(loadContent).mockImplementation(() => new Promise(() => {})); largeRenderChoices.clear(); }
  });

  it("an HTML page stored as text/plain under a label name has 预览 · 源代码 · 出处 · 对比", () => {
    const html = renderView("round2-html-artifact", "text/plain", "C:\\work\\acc\\page.html");
    expect(tabs(html)).toEqual(["preview", "code", "origin", "compare"]);
    expect(html).toContain("artifacts.page.code");
    expect(html).toContain('data-testid="page-frame"');
  });

  it("a text/html version has the same tabs; plain text has no 源代码", () => {
    expect(tabs(renderView("page", "text/html", "/w/page"))).toEqual(["preview", "code", "origin", "compare"]);
    expect(tabs(renderView("notes", "text/plain", "/w/notes.txt"))).toEqual(["preview", "origin", "compare"]);
  });

  it("a PDF stored as octet-stream under a label name is a document, not 'cannot preview'", () => {
    const html = renderView("round2-pdf-artifact", "application/octet-stream", "C:\\work\\acc\\paper.pdf");
    expect(tabs(html)).toEqual(["preview", "origin", "compare"]);
    expect(html).not.toContain("artifacts.binary");
    // The document card keeps a name with the file's extension.
    expect(html).toContain('data-testid="document" data-name="paper.pdf"');
  });

  it("a JPEG stored as octet-stream under a label name is previewed as an image", () => {
    const html = renderView("Holiday photo", "application/octet-stream", "D:\\pics\\IMG_0001.JPG");
    expect(html).not.toContain("artifacts.binary");
    expect(html).toContain("artifacts.loading");
  });
});
