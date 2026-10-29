// @vitest-environment jsdom
// Owner bug 2026-10-21: a message link to a folder (image-references/cafe-stile) opened the preview,
// which showed "not_a_file: path is not a regular file". Openers of paths of unknown kind now ask the
// daemon (lib/pathKind.ts): a folder opens in the 文件 tree, expanded down to it; a host folder outside
// the workspace root says so; a file previews as before.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FsEntry } from "../src/shared/ipc";

const fx = vi.hoisted(() => {
  const opened: unknown[][] = [];
  const sidebar = { hostRows: {}, projects: null, active: [{ cutexSessionId: "eva", cwd: "/home/jy/proj" }], retired: [] };
  const dirs: Record<string, string[]> = { "": ["image-references", "README.md"], "image-references": ["cafe-stile"], "image-references/cafe-stile": ["a.png"] };
  const notADir = () => Promise.reject(new Error("not_a_directory: path is not a directory"));
  const api = {
    fsDir: (_scope: unknown, path: string) => (path in fx.dirs ? Promise.resolve({ root: "/home/jy/proj", path, entries: fx.dirs[path]!.map((name) => fx.entry(path, name)) }) : notADir()),
    browseDirs: (path: string) => (path.startsWith("/home/jy/proj") || path === "/srv/data" ? Promise.resolve({ path, parent: null, entries: [], home: null, roots: ["/"], truncated: false }) : notADir()),
  };
  const entry = (dir: string, name: string): FsEntry => {
    const path = dir ? `${dir}/${name}` : name;
    return { name, path, kind: path in fx.dirs ? "dir" : "file", targetKind: null, size: null, modifiedAt: null, ignored: false } as unknown as FsEntry;
  };
  const state = { selectedId: "eva", notify: null as unknown as (...args: unknown[]) => void };
  return { opened, sidebar, dirs, api, entry, state };
});

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("../src/renderer/src/lib/sideServices", () => ({ sideOpen: (...args: unknown[]) => (fx.opened.push(args), { status: "opened", instanceId: "i1", pageId: "p1", reused: false }) }));
vi.mock("../src/renderer/src/store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useApp: Object.assign((select: (s: unknown) => unknown) => select(fx.state), { getState: () => fx.state, setState: () => {}, subscribe: () => () => {} }),
  selectedSidebar: () => fx.sidebar,
  agentHost: () => "local",
  hostApi: () => fx.api,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { openFile, openHostPath, openPath } = await import("../src/renderer/src/lib/sideOpen");
const { clearPathKindCache } = await import("../src/renderer/src/lib/pathKind");
const { loadLocale } = await import("../src/renderer/src/i18n");
// translate() is called outside React; wait for its lazy English catalog before English assertions.
await loadLocale("en");

describe("opening a folder", { timeout: 20_000 }, () => {
  beforeEach(() => {
    fx.opened.length = 0;
    fx.state.notify = vi.fn();
    clearPathKindCache();
  });

  it("a folder link opens the 文件 tree revealed at it; a file link the preview", async () => {
    await openPath("image-references/cafe-stile");
    await openPath("README.md", 3);
    expect(fx.opened).toEqual([
      ["workspace.files", { reveal: "image-references/cafe-stile" }, { focus: true }],
      ["workspace.preview", { path: "README.md", line: 3 }, {}],
    ]);
  });

  it("a host folder inside the workspace root reveals its relative path", async () => {
    await openHostPath("/home/jy/proj/image-references/cafe-stile");
    await openHostPath("/home/jy/proj/");
    expect(fx.opened).toEqual([
      ["workspace.files", { reveal: "image-references/cafe-stile" }, { focus: true }],
      ["workspace.files", { reveal: "" }, { focus: true }],
    ]);
  });

  it("a host folder outside the root: a notice, no preview; a host file still previews", async () => {
    await openHostPath("/srv/data");
    expect(fx.opened).toEqual([]);
    expect(fx.state.notify).toHaveBeenCalledWith("This is a folder outside the workspace, so it cannot be opened in the file tree", "info");
    await openHostPath("/home/jy/report.md", 7);
    expect(fx.opened).toEqual([["workspace.preview", { path: "/home/jy/report.md", line: 7, host: true }, {}]]);
  });

  it("asks the daemon once per path for a while (cache)", async () => {
    const spy = vi.spyOn(fx.api, "fsDir");
    await openPath("image-references/cafe-stile");
    await openPath("image-references/cafe-stile");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("openFile stays synchronous (the file tree knows its files)", () => {
    openFile("docs/DESIGN.md");
    expect(fx.opened).toEqual([["workspace.preview", { path: "docs/DESIGN.md", line: null }, {}]]);
  });
});

describe("文件 tree reveal", { timeout: 20_000 }, () => {
  let root: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("opens the ancestors of the revealed folder and selects it (the 文件 explorer, 019 §3)", async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const { FilesBody } = await import("../src/renderer/src/modules/workspace/Files");
    const { WorkspaceContext, NO_DIR_VERSIONS } = await import("../src/renderer/src/lib/workspaceView");
    const ctx = { hostId: "local", api: fx.api as never, scope: { kind: "session" as const, id: "eva" }, revision: 0, git: null, error: null, dirs: NO_DIR_VERSIONS };
    const props = { instance: { state: { q: "", reveal: "image-references/cafe-stile", revealSeq: 1 } }, setState: () => {} } as never;
    await act(async () => {
      root.render(h(WorkspaceContext.Provider, { value: ctx }, h(FilesBody, props)));
    });
    // Each level loads after its parent opens.
    for (let i = 0; i < 5; i++) await act(async () => {});
    // The revealed folder is selected (and scrolled to: the list's own scroll), the way down open.
    const revealed = host.querySelector('[data-selected][data-path="image-references/cafe-stile"]');
    expect(revealed).not.toBeNull();
    expect(revealed?.getAttribute("aria-selected")).toBe("true");
    // The revealed folder is expanded too.
    expect(host.querySelector('[data-path="image-references/cafe-stile/a.png"]')).not.toBeNull();
    // Siblings on the way stay as they were.
    expect(host.querySelector('[data-path="README.md"]')).not.toBeNull();
    expect(scrolled).toBeDefined();
  });
});
