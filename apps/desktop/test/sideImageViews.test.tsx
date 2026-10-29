// @vitest-environment jsdom
// Where side-pane images show (owner 2026-10-25): a Shelf artifact image and an image file in the 文件 explorer /
// 预览 card render through components/SideImage, so a left click enlarges them (the conversation's view).
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArtifactContent, ArtifactDetail, ArtifactVersion } from "../src/shared/artifactStore";

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
const B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
vi.mock("../src/renderer/src/modules/artifacts/store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadContent: async (): Promise<ArtifactContent> => ({ version: 1, encoding: "base64", content: B64, offset: 0, totalBytes: 68, truncated: false, mediaType: "image/png", sha256: null, externalChanged: null }),
  loadDiff: () => new Promise(() => {}),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ViewBody } = await import("../src/renderer/src/modules/artifacts/View");
const { useArtifactCache } = await import("../src/renderer/src/modules/artifacts/store");
const { FileView } = await import("../src/renderer/src/modules/workspace/FileView");

const ID = "af-0123456789abcdef0123456789abcdef";
const zoom = () => document.querySelector<HTMLElement>('[data-testid="message-image-zoom"]');
let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});
function mount(node: ReturnType<typeof h>) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  return { host, render: () => act(async () => root.render(node)) };
}

describe("side-pane image previews", () => {
  it("an artifact image enlarges on a left click", async () => {
    const v = { artifactId: ID, version: 1, ref: `${ID}@1`, link: `cutex:artifact/${ID}@1`, storage: "blob", sha256: "x", bytes: 68, mediaType: "image/png", sourcePath: "D:/pics/chart.png", note: null, producer: { kind: "owner" }, git: null, createdAt: "2026-10-10T01:00:00Z" } as unknown as ArtifactVersion;
    const detail = { artifact: { artifactId: ID, scope: { kind: "project", id: "p" }, name: "chart.png", kind: "other", latestVersion: 1, revision: 1, starred: false, archivedAt: null, createdAt: "", updatedAt: "", latest: v }, versions: [v] } as unknown as ArtifactDetail;
    useArtifactCache.setState({ details: { [`local|${ID}`]: detail }, errors: {} });
    const props = { instance: { id: "t", state: { ref: `${ID}@latest`, pane: "preview" } }, hostId: "local", setState: () => {}, open: () => {} };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a minimal SideBodyProps
    const { host, render } = mount(h(ViewBody, props as any));
    await render();
    await vi.waitFor(() => expect(host.querySelector("[data-side-image] img")).not.toBeNull());
    const img = host.querySelector<HTMLImageElement>("[data-side-image] img")!;
    expect(img.getAttribute("src")).toBe(`data:image/png;base64,${B64}`);
    expect(host.querySelector("[data-side-image-toolbar] [data-side-image-copy]")).not.toBeNull();
    act(() => img.click());
    expect(zoom()).not.toBeNull();
  });

  it("an image file in the file view enlarges on a left click", async () => {
    const read = async () => ({ path: "shot.png", size: 68, modifiedAt: "", encoding: "base64" as const, content: B64, truncated: false, mime: "image/png" });
    const api = { hostFile: read, fsFile: read } as never;
    const { host, render } = mount(h(FileView, { api, hostId: "local", scope: null, path: "D:/p/shot.png", host: true }));
    await render();
    await vi.waitFor(() => expect(host.querySelector("[data-side-image] img")).not.toBeNull());
    act(() => host.querySelector<HTMLElement>("[data-side-image-enlarge]")!.click());
    expect(zoom()!.querySelector("img")!.getAttribute("src")).toBe(`data:image/png;base64,${B64}`);
  });
});
