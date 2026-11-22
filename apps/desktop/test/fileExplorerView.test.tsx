// @vitest-environment jsdom
// The 文件 explorer as the owner uses it (docs/design/019-file-explorer.md): arrow keys move the selection and
// the built-in preview follows; Enter on a folder goes into it (breadcrumb), Alt+← comes back with the
// selection, Alt+↑ goes up; → / ← open / close; the filter; a click on a file with no room for the preview
// opens the 预览 card; Enter on a file opens it as a kept tab; dragging rows carries their paths.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FsEntry } from "../src/shared/ipc";

const fx = vi.hoisted(() => {
  const opened: unknown[][] = [];
  const sidebar = { hostRows: {}, projects: null, active: [{ cutexSessionId: "eva", cwd: "/home/jy/proj" }], retired: [] };
  const dirs: Record<string, string[]> = {
    "": [".github", "docs", "src", "README.md"],
    ".github": ["ci.yml"],
    docs: ["DESIGN.md", "notes.md"],
    src: ["lib", "main.ts"],
    "src/lib": ["a.ts"],
  };
  const entry = (dir: string, name: string): FsEntry => {
    const path = dir ? `${dir}/${name}` : name;
    return { name, path, kind: path in fx.dirs ? "dir" : "file", targetKind: null, size: 10, modifiedAt: "2026-10-01T00:00:00Z", ignored: false } as FsEntry;
  };
  const api = {
    fsDir: (_scope: unknown, path: string) => (path in fx.dirs ? Promise.resolve({ root: "/home/jy/proj", path, entries: fx.dirs[path]!.map((n) => fx.entry(path, n)) }) : Promise.reject(new Error("not_a_directory: path is not a directory"))),
    fsFile: (_scope: unknown, path: string) => Promise.resolve({ path, size: 5, modifiedAt: "2026-10-01T00:00:00Z", encoding: "utf8", content: "hello", truncated: false, mime: "text/plain" }),
    fsSearch: () => Promise.resolve({ query: "", results: [] }),
  };
  const state = { selectedId: "eva", notify: () => {}, insertIntoComposer: vi.fn() };
  return { opened, sidebar, dirs, api, entry, state };
});

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("../src/renderer/src/components/Markdown", () => ({ Markdown: ({ text }: { text: string }) => h("pre", { "data-md": "" }, text) }));
vi.mock("../src/renderer/src/lib/sideServices", () => ({ sideOpen: (...args: unknown[]) => (fx.opened.push(args), { status: "opened", instanceId: "i1", pageId: "p1", reused: false }) }));
vi.mock("../src/renderer/src/store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useApp: Object.assign((select: (s: unknown) => unknown) => select(fx.state), { getState: () => fx.state, setState: () => {}, subscribe: () => () => {} }),
  selectedSidebar: () => fx.sidebar,
  agentHost: () => "local",
  hostApi: () => fx.api,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { FilesBody } = await import("../src/renderer/src/modules/workspace/Files");
const { ChangesBody } = await import("../src/renderer/src/modules/workspace/Changes");
const { WorkspaceContext, NO_DIR_VERSIONS } = await import("../src/renderer/src/lib/workspaceView");
const { useExplorerStore, setExplorerOptions } = await import("../src/renderer/src/modules/workspace/explorer/store");
const { DEFAULT_OPTIONS } = await import("../src/renderer/src/modules/workspace/explorer/model");
const { clearPathKindCache } = await import("../src/renderer/src/lib/pathKind");

const settle = async (n = 6) => {
  for (let i = 0; i < n; i++) await act(async () => {});
};

describe("文件 explorer", { timeout: 20_000 }, () => {
  let root: Root;
  let host: HTMLDivElement;
  const ctx = { hostId: "local", api: fx.api as never, scope: { kind: "session" as const, id: "eva" }, revision: 0, git: null, gitIssue: null as import("../src/renderer/src/lib/transientError").ReadIssue | null, reloadGit: () => {}, dirs: NO_DIR_VERSIONS };
  const render = async (state: Record<string, unknown> = { q: "" }, value: typeof ctx = ctx) => {
    const props = { instance: { id: "f1", state }, setState: () => {}, sessionId: "eva", hostId: "local", close: () => {} } as never;
    await act(async () => root.render(h(WorkspaceContext.Provider, { value }, h(FilesBody, props))));
    await settle();
  };
  const list = () => host.querySelector<HTMLElement>("[data-explorer-list]")!;
  const press = async (key: string, extra: KeyboardEventInit = {}) => {
    await act(async () => list().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra })));
    await settle(3);
  };
  const selected = () => host.querySelector("[data-selected]")?.getAttribute("data-path") ?? null;
  const rows = () => [...host.querySelectorAll("[role=treeitem]")].map((r) => r.getAttribute("data-path"));
  const crumbs = () => [...host.querySelectorAll("[data-explorer] > div:first-child button")].map((b) => b.textContent).filter(Boolean);

  beforeEach(() => {
    localStorage.clear();
    useExplorerStore.setState({ options: { ...DEFAULT_OPTIONS }, roots: {} }, true);
    fx.opened.length = 0;
    clearPathKindCache();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  // Owner 2026-11-16: the panel showed only red `git_status_busy: git status is busy; retry shortly`, with no
  // reload and no retry. Git status only decorates the tree; failed reads say so plainly and offer 重新加载.
  describe("failed host reads", () => {
    const busy = (what = "git status is busy; retry shortly") => new Error(`git_status_busy: ${what}`);
    const issueLine = () => host.querySelector<HTMLElement>("[data-read-issue]");
    const reloadButton = () => [...(issueLine()?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.includes("readIssue.reload"))!;
    const fsDir = fx.api.fsDir;
    const fsSearch = fx.api.fsSearch;
    afterEach(() => {
      fx.api.fsDir = fsDir;
      fx.api.fsSearch = fsSearch;
    });

    it("a busy git status leaves the tree on screen with a quiet retry line and 重新加载", async () => {
      const reloadGit = vi.fn();
      await render({ q: "" }, { ...ctx, gitIssue: { code: "git_status_busy", detail: "git_status_busy: git status is busy; retry shortly", retrying: true }, reloadGit });
      expect(rows()).toEqual(["docs", "src", "README.md"]);
      expect(host.textContent).not.toContain("git status is busy");
      expect(issueLine()!.getAttribute("data-read-issue")).toBe("retrying");
      expect(issueLine()!.textContent).toContain("workspace.git.retrying");
      expect(issueLine()!.title).toContain("git_status_busy");
      await act(async () => reloadButton().click());
      expect(reloadGit).toHaveBeenCalledTimes(1);
      // Not retrying (e.g. git missing): still the tree, the line says it could not be read.
      await render({ q: "" }, { ...ctx, gitIssue: { code: "git_unavailable", detail: "git_unavailable: no git", retrying: false }, reloadGit });
      expect(rows()).toEqual(["docs", "src", "README.md"]);
      expect(issueLine()!.textContent).toContain("workspace.git.failed");
    });

    it("a busy folder read retries by itself and then shows the folder", async () => {
      let calls = 0;
      fx.api.fsDir = (scope: unknown, path: string) => (path === "" && calls++ === 0 ? Promise.reject(new Error("heavy_read_capacity_exceeded: heavy-read wait queue is full; retry shortly")) : fsDir(scope, path));
      await render();
      expect(rows()).toEqual([]);
      expect(issueLine()!.textContent).toContain("workspace.fx.dirRetrying");
      await act(async () => new Promise((r) => setTimeout(r, 1_100)));
      await settle();
      expect(rows()).toEqual(["docs", "src", "README.md"]);
      expect(issueLine()).toBeNull();
    });

    it("a folder read that will not recover by itself waits for 重新加载", async () => {
      let broken = true;
      fx.api.fsDir = (scope: unknown, path: string) => (broken ? Promise.reject(new Error("permission_denied: access is denied")) : fsDir(scope, path));
      await render();
      expect(issueLine()!.getAttribute("data-read-issue")).toBe("failed");
      expect(issueLine()!.textContent).toContain("workspace.fx.dirFailed");
      expect(issueLine()!.title).toContain("permission_denied");
      await act(async () => new Promise((r) => setTimeout(r, 1_100)));
      await settle();
      expect(rows()).toEqual([]);
      broken = false;
      await act(async () => reloadButton().click());
      await settle();
      expect(rows()).toEqual(["docs", "src", "README.md"]);
    });

    it("a failed search says so instead of 0 results, and retries", async () => {
      let calls = 0;
      fx.api.fsSearch = () => (calls++ === 0 ? Promise.reject(busy("file search is busy")) : Promise.resolve({ query: "main", results: [{ path: "src/main.ts" }] })) as never;
      await render({ q: "main" });
      await act(async () => new Promise((r) => setTimeout(r, 200)));
      await settle();
      expect(issueLine()!.textContent).toContain("workspace.fx.searchRetrying");
      expect(host.textContent).not.toContain("workspace.fx.searchCount");
      await act(async () => new Promise((r) => setTimeout(r, 1_300)));
      // The retry's state update lands when that act ends; the search then runs after its 150 ms pause.
      await act(async () => new Promise((r) => setTimeout(r, 300)));
      await settle();
      expect(calls).toBe(2);
      expect(issueLine()).toBeNull();
      expect(host.textContent).toContain("main.ts");
    });

    // Cross-review 2026-11-16 (gate-notice-review repro): a transient failure re-reading the same search kept nothing.
    it("a failed refresh of the same search keeps the last good results under the retry line", async () => {
      let calls = 0;
      fx.api.fsSearch = (() => ++calls === 1
        ? Promise.resolve({ query: "main", results: [{ path: "src/main.ts" }] })
        : Promise.reject(new Error("heavy_read_capacity_exceeded: busy"))) as never;
      await render({ q: "main" });
      await act(async () => new Promise((resolve) => setTimeout(resolve, 200)));
      expect(host.querySelector('[role="listbox"] [data-path="src/main.ts"]')).not.toBeNull();
      await render({ q: "main" }, { ...ctx, revision: 1 });
      await act(async () => new Promise((resolve) => setTimeout(resolve, 200)));
      expect(calls).toBe(2);
      expect(host.querySelector('[data-read-issue="retrying"]')).not.toBeNull();
      expect(host.querySelector('[role="listbox"] [data-path="src/main.ts"]')).not.toBeNull();
    });

    it("the 改动 card shows a plain line with 重新加载, and keeps the last list under it", async () => {
      const reloadGit = vi.fn();
      const props = { instance: { id: "c1", state: null }, setState: () => {}, sessionId: "eva", hostId: "local", close: () => {} } as never;
      const issue = { code: "git_status_busy", detail: "git_status_busy: git status is busy; retry shortly", retrying: true };
      await act(async () => root.render(h(WorkspaceContext.Provider, { value: { ...ctx, gitIssue: issue, reloadGit } }, h(ChangesBody, props))));
      expect(issueLine()!.textContent).toContain("workspace.changes.retrying");
      expect(host.textContent).not.toContain("git status is busy");
      await act(async () => reloadButton().click());
      expect(reloadGit).toHaveBeenCalledTimes(1);
      const git = { isRepo: true, branch: "main", upstream: null, ahead: 0, behind: 0, head: null, files: [{ path: "src/main.ts", status: "modified", staged: false, added: 1, deleted: 0 }] };
      await act(async () => root.render(h(WorkspaceContext.Provider, { value: { ...ctx, git: git as never, gitIssue: issue, reloadGit } }, h(ChangesBody, props))));
      expect(issueLine()).not.toBeNull();
      expect(host.textContent).toContain("main.ts");
    });
  });

  it("hidden files are off; arrows move and the preview follows; → / ← open and close", async () => {
    await render();
    expect(rows()).toEqual(["docs", "src", "README.md"]);
    await press("ArrowDown");
    expect(selected()).toBe("docs");
    await press("ArrowRight");
    expect(rows()).toEqual(["docs", "docs/DESIGN.md", "docs/notes.md", "src", "README.md"]);
    await press("ArrowRight");
    expect(selected()).toBe("docs/DESIGN.md");
    await act(async () => new Promise((r) => setTimeout(r, 160)));
    await settle();
    // Single click / arrows = the built-in preview (decision 1), not the 预览 card.
    expect(host.querySelector("[data-explorer-preview]")?.textContent).toContain("DESIGN.md");
    expect(fx.opened).toEqual([]);
    await press("ArrowLeft");
    expect(selected()).toBe("docs");
    await press("ArrowLeft");
    expect(rows()).toEqual(["docs", "src", "README.md"]);
  });

  it("Enter goes into a folder, Alt+← comes back with the selection, Alt+↑ goes up", async () => {
    await render();
    await press("ArrowDown");
    await press("ArrowDown");
    expect(selected()).toBe("src");
    await press("Enter");
    expect(rows()).toEqual(["src/lib", "src/main.ts"]);
    expect(crumbs()).toContain("src");
    await press("ArrowLeft", { altKey: true });
    expect(rows()).toEqual(["docs", "src", "README.md"]);
    expect(selected()).toBe("src");
    await press("ArrowRight", { altKey: true });
    expect(rows()).toEqual(["src/lib", "src/main.ts"]);
    await press("ArrowUp", { altKey: true });
    expect(rows()).toEqual(["docs", "src", "README.md"]);
    // Up selects the folder we came from (Windows / Finder).
    expect(selected()).toBe("src");
  });

  it("Enter on a file opens it as a kept 预览 tab; type-ahead jumps", async () => {
    await render();
    await press("r");
    expect(selected()).toBe("README.md");
    await press("Enter");
    expect(fx.opened).toEqual([["workspace.preview", { path: "README.md", line: null }, { pin: true }]]);
  });

  it("with the preview off a click opens the 预览 card as before", async () => {
    setExplorerOptions({ preview: false });
    await render();
    const readme = host.querySelector<HTMLElement>('[data-path="README.md"]')!;
    await act(async () => readme.click());
    await settle();
    expect(fx.opened).toEqual([["workspace.preview", { path: "README.md", line: null }, {}]]);
  });

  it("the filter keeps parents of matches in folders already read", async () => {
    await render();
    await press("ArrowDown");
    await press("ArrowRight");
    const input = host.querySelector<HTMLInputElement>("[data-explorer] input")!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "note");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect(rows()).toEqual(["docs", "docs/notes.md"]);
  });

  it("a reveal of a hidden file shows it (and its hidden folder, marked)", async () => {
    await render({ q: "", reveal: ".github/ci.yml", revealSeq: 1 });
    await settle(8);
    expect(rows()).toEqual([".github", ".github/ci.yml", "docs", "src", "README.md"]);
    expect(selected()).toBe(".github/ci.yml");
    expect(host.querySelector('[data-path=".github"]')?.textContent).toContain("workspace.fx.hiddenTag");
  });

  it("dragging the tree / preview line moves the panes by style and stores the split once, on release", async () => {
    await render();
    const line = host.querySelector<HTMLElement>("[data-explorer] [role=separator]")!;
    const panes = line.parentElement!;
    panes.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) });
    line.setPointerCapture = () => {};
    let stores = 0;
    const off = useExplorerStore.subscribe(() => stores++);
    const before = useExplorerStore.getState().options.split;
    const pointer = (type: string, x: number) => {
      const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 10 });
      Object.defineProperty(ev, "pointerId", { value: 1 });
      return ev;
    };
    await act(async () => line.dispatchEvent(pointer("pointerdown", 200)));
    for (const x of [180, 160, 140, 120]) await act(async () => line.dispatchEvent(pointer("pointermove", x)));
    expect(stores).toBe(0);
    expect(useExplorerStore.getState().options.split).toBe(before);
    expect(panes.style.getPropertyValue("--fx-split")).toBe("0.3");
    await act(async () => line.dispatchEvent(pointer("pointerup", 120)));
    await act(async () => new Promise<void>((r) => requestAnimationFrame(() => r())));
    expect(stores).toBe(1);
    expect(useExplorerStore.getState().options.split).toBe(0.3);
    expect(panes.style.getPropertyValue("--fx-split")).toBe("");
    off();
  });

  it("dragging rows carries their paths for the composer", async () => {
    await render();
    const data = new Map<string, string>();
    const ev = new Event("dragstart", { bubbles: true }) as DragEvent;
    Object.defineProperty(ev, "dataTransfer", { value: { setData: (k: string, v: string) => data.set(k, v), effectAllowed: "" } });
    await act(async () => host.querySelector('[data-path="README.md"]')!.dispatchEvent(ev));
    expect(JSON.parse(data.get("application/x-cutex-workspace-path")!)).toEqual(["README.md"]);
    expect(data.get("text/plain")).toBe("README.md");
  });
});
