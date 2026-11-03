// @vitest-environment jsdom
// 远程文件副本: text / place filter, sort per key (ties stay put), persisted sort + view, the compact list view's
// sortable headers, narrow columns, row menu (same actions, armed delete) and keyboard.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CopyState, RemoteCopy } from "../src/shared/remoteCopies";

const f = vi.hoisted(() => ({ call: vi.fn(), open: vi.fn(), menuFrom: vi.fn(), menuAt: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { shell: { remoteCopies: f.call } }, api: {}, onEvent: () => () => {} }));
vi.mock("../src/renderer/src/lib/sideOpen", () => ({ openSide: f.open }));
vi.mock("../src/renderer/src/lib/contextMenu", async (orig) => ({
  ...(await orig<object>()),
  openMenuFrom: f.menuFrom,
  contextMenu: (build: () => unknown) => (e: MouseEvent) => { e.preventDefault(); f.menuAt(build()); },
}));

const view = await import("../src/renderer/src/modules/remote-copies/view");
const { CopyPage } = await import("../src/renderer/src/modules/remote-copies/CopyPage");
const { I18nProvider } = await import("../src/renderer/src/i18n");
const { useCopies } = await import("../src/renderer/src/lib/remoteCopies");
const { filterCopies, sortCopies, placeOptions, pickSort, setCopyView, reloadCopyView, useCopyView, COPY_VIEW_STORAGE_KEY, DEFAULT_COPY_VIEW } = view;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base = { hostId: "h1", hostLabel: "workstation", hostIdentity: "W", path: "/w/x" };
let n = 0;
function copy(name: string, patch: Partial<RemoteCopy> & { at?: string } = {}): RemoteCopy {
  const { at = "2026-10-20T00:00:00Z", ...rest } = patch;
  return { id: `c${++n}`, source: { ...base, path: `/w/${name}` }, name, size: 100, received: 100, status: "complete", createdAt: at, downloadedAt: at, expiresAt: null, kept: false, sha256: null, ...rest };
}
const names = { host: (id: string) => (id === "h2" ? "alpha" : undefined), project: (_h: string, id: string) => (id === "p1" ? "Demo study" : undefined) };
const ids = (rows: RemoteCopy[]) => rows.map((c) => c.name);

describe("filter", () => {
  const rows = [
    copy("Report.PDF"),
    copy("data.csv", { source: { ...base, path: "/w/reports/data.csv" } }),
    copy("model.bin", { source: { ...base, hostId: "h2", hostLabel: "old-alpha", path: "/a/model.bin" } }),
    copy("panel.parquet", { source: { ...base, path: "/w/demo/panel.parquet", scope: { kind: "project", id: "p1" } } }),
    copy("notes.md", { source: { ...base, path: "/w/notes.md", scope: { kind: "project", id: "p9" } } }),
  ];
  it("matches the name or the remote path, case-insensitively, every word", () => {
    expect(ids(filterCopies(rows, { text: "report", place: "" }, names))).toEqual(["Report.PDF", "data.csv"]);
    expect(ids(filterCopies(rows, { text: "  REPORTS csv ", place: "" }, names))).toEqual(["data.csv"]);
    expect(ids(filterCopies(rows, { text: "nothing", place: "" }, names))).toEqual([]);
    expect(filterCopies(rows, { text: "   ", place: "" }, names)).toHaveLength(rows.length);
  });
  it("offers each host then its projects (current names, else the saved label / id); a host includes its projects", () => {
    expect(placeOptions(rows, names)).toEqual([
      { value: "host:h2", label: "alpha" },
      { value: "host:h1", label: "workstation" },
      { value: "project:h1|p1", label: "workstation · Demo study" },
      { value: "project:h1|p9", label: "workstation · p9" },
    ]);
    expect(ids(filterCopies(rows, { text: "", place: "host:h2" }, names))).toEqual(["model.bin"]);
    expect(ids(filterCopies(rows, { text: "", place: "host:h1" }, names))).toEqual(["Report.PDF", "data.csv", "panel.parquet", "notes.md"]);
    expect(ids(filterCopies(rows, { text: "", place: "project:h1|p1" }, names))).toEqual(["panel.parquet"]);
    expect(ids(filterCopies(rows, { text: "demo", place: "project:h1|p9" }, names))).toEqual([]);
  });
});

describe("sort", () => {
  const a = copy("b-file", { size: 300, at: "2026-10-03T00:00:00Z" });
  const b = copy("A-file", { size: 100, at: "2026-10-01T00:00:00Z", source: { ...base, hostId: "h2" } });
  const c = copy("file10", { size: 300, at: "2026-10-02T00:00:00Z" });
  const d = copy("file9", { size: 50, downloadedAt: null, createdAt: "2026-10-04T00:00:00Z" });
  const rows = [a, b, c, d];
  it("by name: natural, case-insensitive; descending reverses", () => {
    expect(ids(sortCopies(rows, { sort: "name", desc: false }, names))).toEqual(["A-file", "b-file", "file9", "file10"]);
    expect(ids(sortCopies(rows, { sort: "name", desc: true }, names))).toEqual(["file10", "file9", "b-file", "A-file"]);
  });
  it("by size: equal sizes stay A→Z in both directions", () => {
    expect(ids(sortCopies(rows, { sort: "size", desc: true }, names))).toEqual(["b-file", "file10", "A-file", "file9"]);
    expect(ids(sortCopies(rows, { sort: "size", desc: false }, names))).toEqual(["file9", "A-file", "b-file", "file10"]);
  });
  it("by date: downloaded, else requested", () => {
    expect(ids(sortCopies(rows, { sort: "date", desc: true }, names))).toEqual(["file9", "b-file", "file10", "A-file"]);
    expect(ids(sortCopies(rows, { sort: "date", desc: false }, names))).toEqual(["A-file", "file10", "b-file", "file9"]);
  });
  it("by host (current label), then name", () => {
    expect(ids(sortCopies(rows, { sort: "host", desc: false }, names))).toEqual(["A-file", "b-file", "file9", "file10"]);
    expect(ids(sortCopies(rows, { sort: "host", desc: true }, names))).toEqual(["b-file", "file9", "file10", "A-file"]);
  });
  it("is stable: identical keys and names keep their incoming order, and the input is not changed", () => {
    const twins = [copy("same", { size: 1 }), copy("same", { size: 1 }), copy("same", { size: 1 })];
    for (const sort of ["name", "size", "date", "host"] as const)
      for (const desc of [false, true]) expect(sortCopies(twins, { sort, desc }, names).map((x) => x.id)).toEqual(twins.map((x) => x.id));
    const before = rows.map((x) => x.id);
    sortCopies(rows, { sort: "size", desc: true }, names);
    expect(rows.map((x) => x.id)).toEqual(before);
  });
  it("a header pick flips the same key and starts a new key in its natural direction", () => {
    expect(pickSort({ sort: "name", desc: false }, "name")).toEqual({ sort: "name", desc: true });
    expect(pickSort({ sort: "name", desc: false }, "size")).toEqual({ sort: "size", desc: true });
    expect(pickSort({ sort: "date", desc: true }, "host")).toEqual({ sort: "host", desc: false });
  });
});

describe("persistence", () => {
  beforeEach(() => { localStorage.clear(); reloadCopyView(); });
  it("defaults to newest first in cards, and remembers sort, direction and view", () => {
    expect(useCopyView.getState()).toEqual(DEFAULT_COPY_VIEW);
    setCopyView({ sort: "size", desc: false, view: "list" });
    expect(JSON.parse(localStorage.getItem(COPY_VIEW_STORAGE_KEY)!)).toEqual({ sort: "size", desc: false, view: "list" });
    useCopyView.setState(DEFAULT_COPY_VIEW, true);
    reloadCopyView();
    expect(useCopyView.getState()).toEqual({ sort: "size", desc: false, view: "list" });
  });
  it("drops malformed stored values", () => {
    localStorage.setItem(COPY_VIEW_STORAGE_KEY, JSON.stringify({ sort: "colour", desc: "yes", view: "grid" }));
    reloadCopyView();
    expect(useCopyView.getState()).toEqual(DEFAULT_COPY_VIEW);
    localStorage.setItem(COPY_VIEW_STORAGE_KEY, "{not json");
    reloadCopyView();
    expect(useCopyView.getState()).toEqual(DEFAULT_COPY_VIEW);
  });
});

describe("page", () => {
  let root: Root;
  let host: HTMLDivElement;
  let width = 800;
  const rows = [
    copy("zeta.pdf", { size: 2048, at: "2026-10-05T00:00:00Z" }),
    copy("alpha.csv", { size: 4096, at: "2026-10-01T00:00:00Z", kept: true }),
    copy("mid.bin", { size: 1024, at: "2026-10-03T00:00:00Z", status: "expired", downloadedAt: "2026-10-03T00:00:00Z" }),
  ];
  const state: CopyState = { copies: rows, settings: { retentionDays: 7, largeFileBytes: 1 } };
  const mount = async () => {
    await act(async () => root.render(h(I18nProvider, null, h(CopyPage))));
    await act(async () => { await Promise.resolve(); });
  };
  const listNames = () => [...host.querySelectorAll("[data-copy-list-row] [data-copy-name]")].map((e) => e.textContent);
  const cardNames = () => [...host.querySelectorAll("[data-copy-row] h3")].map((e) => e.textContent);
  const headers = () => [...host.querySelectorAll("thead th")].map((th) => th.textContent);
  const press = (el: Element, key: string, init: KeyboardEventInit = {}) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })); });
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    reloadCopyView();
    width = 800;
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return (this as HTMLElement).hasAttribute("data-copy-list") ? width : 0; } });
    f.call.mockImplementation(async (req: { kind: string }) => (req.kind === "list" ? structuredClone(state) : undefined));
    useCopies.setState({ state: structuredClone(state), pending: null, busy: false, starting: false, error: null });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it("cards: newest first, the text filter narrows and clears, the sort menu offers every key", async () => {
    await mount();
    expect(cardNames()).toEqual(["zeta.pdf", "mid.bin", "alpha.csv"]);
    const input = host.querySelector<HTMLInputElement>("[data-copy-filter]")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "ALPHA");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(cardNames()).toEqual(["alpha.csv"]);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "none-such");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector("[data-copy-no-match]")).not.toBeNull();
    press(input, "Escape");
    expect(cardNames()).toHaveLength(3);
    act(() => host.querySelector<HTMLButtonElement>("[data-copy-sort]")!.click());
    const entries = f.menuFrom.mock.calls[0]![1] as ({ label: string; onSelect(): void } | string)[];
    expect(entries.filter((e) => typeof e === "object").map((e) => (e as { label: string }).label)).toEqual(["Name", "Size", "Date", "Host", "Ascending", "Descending"]);
    act(() => (entries[0] as { onSelect(): void }).onSelect());
    expect(useCopyView.getState()).toMatchObject({ sort: "name", desc: false });
    expect(cardNames()).toEqual(["alpha.csv", "mid.bin", "zeta.pdf"]);
  });

  it("the view toggle switches to the list, is remembered, and the headers sort with aria-sort", async () => {
    await mount();
    const list = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === "List")!;
    act(() => list.click());
    expect(useCopyView.getState().view).toBe("list");
    expect(JSON.parse(localStorage.getItem(COPY_VIEW_STORAGE_KEY)!).view).toBe("list");
    expect(host.querySelector("[data-copy-sort]")).toBeNull();
    expect(headers()).toEqual(["Name", "Host / project", "Size", "Date", "Status", ""]);
    expect(listNames()).toEqual(["zeta.pdf", "mid.bin", "alpha.csv"]);
    const th = (label: string) => [...host.querySelectorAll("thead th")].find((x) => x.textContent === label)!;
    expect(th("Date").getAttribute("aria-sort")).toBe("descending");
    expect(th("Name").getAttribute("aria-sort")).toBe("none");
    expect(th("Status").hasAttribute("aria-sort")).toBe(false);
    act(() => th("Size").querySelector("button")!.click());
    expect(listNames()).toEqual(["alpha.csv", "zeta.pdf", "mid.bin"]);
    act(() => th("Size").querySelector("button")!.click());
    expect(th("Size").getAttribute("aria-sort")).toBe("ascending");
    expect(listNames()).toEqual(["mid.bin", "zeta.pdf", "alpha.csv"]);
    act(() => root.unmount());
    root = createRoot(host);
    await mount();
    expect(listNames()).toEqual(["mid.bin", "zeta.pdf", "alpha.csv"]);
  });

  it("narrow lists drop host, then date, then size, keeping name and status", async () => {
    setCopyView({ view: "list" });
    width = 40 * 16;
    await mount();
    expect(headers()).toEqual(["Name", "Size", "Date", "Status", ""]);
    act(() => root.unmount()); root = createRoot(host); width = 32 * 16; await mount();
    expect(headers()).toEqual(["Name", "Size", "Status", ""]);
    act(() => root.unmount()); root = createRoot(host); width = 24 * 16; await mount();
    expect(headers()).toEqual(["Name", "Status", ""]);
  });

  it("right-click and ⋯ open the same actions with an armed delete; disabled rules match the card", async () => {
    setCopyView({ view: "list", sort: "name", desc: false });
    await mount();
    const row = (name: string) => [...host.querySelectorAll<HTMLElement>("[data-copy-list-row]")].find((r) => r.textContent?.includes(name))!;
    act(() => { row("mid.bin").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    const entries = (f.menuAt.mock.calls[0]![0] as ({ label: string; disabled?: boolean; armed?: string; danger?: boolean } | string)[]).filter((e) => typeof e === "object") as { label: string; disabled?: boolean; armed?: string; danger?: boolean; onSelect(): void }[];
    expect(entries.map((e) => e.label)).toEqual(["Open copy", "Show in folder", "Open remote original", "Download again", "Keep", "Delete copy now"]);
    expect(entries.map((e) => !!e.disabled)).toEqual([true, true, true, true, true, false]);
    expect(entries.at(-1)).toMatchObject({ danger: true, armed: "Click again to delete this copy" });
    act(() => row("alpha.csv").querySelector<HTMLButtonElement>("[data-copy-more]")!.click());
    const more = (f.menuFrom.mock.calls[0]![1] as ({ label: string; disabled?: boolean; onSelect(): void } | string)[]).filter((e) => typeof e === "object") as { label: string; disabled?: boolean; onSelect(): void }[];
    expect(more.map((e) => e.label)).toEqual(["Open copy", "Show in folder", "Open remote original", "Download again", "Stop keeping", "Delete copy now"]);
    expect(more[0]!.disabled).toBe(false);
    await act(async () => more[4]!.onSelect());
    expect(f.call).toHaveBeenCalledWith(expect.objectContaining({ kind: "keep", value: false }));
  });

  it("keyboard: one tab stop, ↑ ↓ Home End move, Enter opens, Shift+F10 opens the menu", async () => {
    setCopyView({ view: "list", sort: "name", desc: false });
    await mount();
    const rows = [...host.querySelectorAll<HTMLElement>("[data-copy-list-row]")];
    expect(rows.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    act(() => rows[0]!.focus());
    press(rows[0]!, "ArrowDown");
    expect(document.activeElement).toBe(rows[1]);
    expect(rows.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    press(rows[1]!, "End");
    expect(document.activeElement).toBe(rows[2]);
    press(rows[2]!, "ArrowDown");
    expect(document.activeElement).toBe(rows[2]);
    press(rows[2]!, "Home");
    expect(document.activeElement).toBe(rows[0]);
    await act(async () => press(rows[0]!, "Enter"));
    expect(f.call).toHaveBeenCalledWith({ kind: "open", id: rows[0]!.dataset.copyListRow });
    f.call.mockClear();
    press(rows[1]!, "Enter"); // mid.bin was cleaned up: nothing to open
    expect(f.call).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "open" }));
    press(rows[1]!, "F10", { shiftKey: true });
    expect(f.menuFrom).toHaveBeenCalledWith(rows[1], expect.any(Array));
  });
});
