// @vitest-environment jsdom
// HTML in the file view (owner 2026-10-24): rendered by default in the shared opaque frame (sandbox allow-scripts
// only, main's document), a size gate over FILE_PAGE_PROMPT_BYTES, 看源码 / 预览 remembered per kind of file.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FilePageInput, FilePageResult } from "../src/shared/frames";

const prepareFilePage = vi.fn(async (_input: FilePageInput): Promise<FilePageResult> => ({ ok: true, frame: { id: "f1", url: "about:blank" }, externalRefs: 0 }));
const release = vi.fn(async () => {});
vi.mock("../src/renderer/src/bridge", () => ({
  bridge: { on: () => () => {}, frames: { prepareFilePage: (i: FilePageInput) => prepareFilePage(i), release: () => release(), prepareArtifactPage: async () => ({ ok: false, reason: "not-found" }), page: async () => ({}) } },
  api: {},
  onEvent: () => () => {},
}));
const { FileView } = await import("../src/renderer/src/modules/workspace/FileView");
const { I18nProvider } = await import("../src/renderer/src/i18n");
const choice = await import("../src/renderer/src/modules/workspace/viewChoice");
const { initPreview, isSourceToggleable } = await import("../src/renderer/src/modules/workspace/previewState");
const { OPAQUE_FRAME_SANDBOX } = await import("@cutex-desktop/opaque-frame");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fsRead = vi.fn(async (_path: string) => ({ path: "p.html", size: 20, modifiedAt: "", encoding: "utf8" as const, content: "<h1>source</h1>", truncated: false, mime: "text/html" }));
const api = { hostFile: (p: string) => fsRead(p), fsFile: (_s: unknown, p: string) => fsRead(p) } as never;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear();
  choice.resetSourceChoiceCache();
  prepareFilePage.mockClear();
  fsRead.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = (props: Record<string, unknown>) => act(async () => root.render(h(I18nProvider, null, h(FileView, { api, hostId: "local", scope: null, path: "D:/p/preview.html", host: true, ...props } as never))));

describe("HTML in the file view", () => {
  it("renders the page in the opaque frame by default: sandbox allow-scripts only, main's document, the renderer does not read", async () => {
    await render({});
    await vi.waitFor(() => expect(host.querySelector("iframe")).not.toBeNull());
    const frame = host.querySelector("iframe")!;
    expect(OPAQUE_FRAME_SANDBOX).toBe("allow-scripts");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.getAttribute("allow")).toContain("clipboard-read 'none'");
    expect(frame.hasAttribute("srcdoc")).toBe(false);
    expect(frame.getAttribute("src")).toBe("about:blank");
    expect(prepareFilePage).toHaveBeenCalledWith({ hostId: "local", path: "D:/p/preview.html" });
    expect(fsRead).not.toHaveBeenCalled();
  });

  it("passes a workspace scope through; with source it shows the code and asks main for nothing", async () => {
    await render({ host: false, scope: { kind: "session", id: "s1" }, path: "out/r.htm" });
    await vi.waitFor(() => expect(prepareFilePage).toHaveBeenCalledWith({ hostId: "local", path: "out/r.htm", scope: { kind: "session", id: "s1" } }));
    prepareFilePage.mockClear();
    await render({ source: true });
    await vi.waitFor(() => expect(fsRead).toHaveBeenCalled());
    expect(host.querySelector("iframe")).toBeNull();
    expect(prepareFilePage).not.toHaveBeenCalled();
  });

  it("asks before a page over 5 MB and reads the large page only after 显示页面; over 10 MB only the source", async () => {
    prepareFilePage.mockImplementationOnce(async () => ({ ok: false, reason: "too-large", totalBytes: 7 * 1024 * 1024 }));
    const onSource = vi.fn();
    await render({ onSource });
    await vi.waitFor(() => expect(host.querySelector("[data-page-show-large]")).not.toBeNull());
    expect(host.querySelector("iframe")).toBeNull();
    await act(async () => (host.querySelector("[data-page-show-large]") as HTMLButtonElement).click());
    await vi.waitFor(() => expect(prepareFilePage).toHaveBeenLastCalledWith({ hostId: "local", path: "D:/p/preview.html", large: true }));
    await vi.waitFor(() => expect(host.querySelector("iframe")).not.toBeNull());

    prepareFilePage.mockImplementationOnce(async () => ({ ok: false, reason: "too-large", totalBytes: 12 * 1024 * 1024 }));
    await render({ onSource, path: "D:/p/huge.html" });
    await vi.waitFor(() => expect(host.querySelector("[data-page-note]")).not.toBeNull());
    expect(host.querySelector("[data-page-show-large]")).toBeNull();
    await act(async () => (host.querySelector("[data-page-source]") as HTMLButtonElement).click());
    expect(onSource).toHaveBeenCalledWith(true);
  });

  it("says when the page refers to files it cannot load (inline-only)", async () => {
    prepareFilePage.mockImplementationOnce(async () => ({ ok: true, frame: { id: "f2", url: "about:blank" }, externalRefs: 3 }));
    await render({ path: "D:/p/with-assets.html" });
    await vi.waitFor(() => expect(host.querySelector("[data-page-refs]")?.textContent).toContain("3"));
  });

  it("预览 / 源码 is remembered per kind of file; a line anchor still opens as source", () => {
    expect(isSourceToggleable("a.HTML")).toBe(true);
    expect(isSourceToggleable("a.htm")).toBe(true);
    expect(isSourceToggleable("a.ts")).toBe(false);
    expect(initPreview({ path: "a.html", line: null, host: true }, null).source).toBe(false);
    choice.rememberSourceChoice("html", true);
    expect(initPreview({ path: "b.html", line: null, host: true }, null).source).toBe(true);
    expect(initPreview({ path: "b.md", line: null, host: true }, null).source).toBe(false);
    expect(initPreview({ path: "b.svg", line: 3, host: true }, null).source).toBe(true);
    choice.resetSourceChoiceCache();
    expect(choice.sourceChoice("html")).toBe(true); // stored
    choice.rememberSourceChoice("html", false);
    expect(initPreview({ path: "c.html", line: null, host: false }, null).source).toBe(false);
  });
});
