// @vitest-environment jsdom
// ⌘K palette (modules/quick-switch/Palette.tsx + live.ts): keyboard navigation over the rendered rows,
// Tab through the scope chips, Enter / Ctrl+Enter / click → onOpen(item, beside), Esc / Ctrl+K close,
// and the module's Ctrl+K opener dispatching an open to services.panes.open (in place vs beside).
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { Globe } from "lucide-react";
import type { QsItem } from "../src/renderer/src/modules/quick-switch/model";

const fx = vi.hoisted(() => ({ items: [] as QsItem[], shelves: false }));

vi.mock("../src/renderer/src/modules/quick-switch/useItems", () => ({
  usePaletteItems: () => ({ items: fx.items, shelves: fx.shelves, loadingArtifacts: false, hostLook: () => null }),
}));
vi.mock("../src/renderer/src/i18n", () => ({
  I18nProvider: ({ children }: { children: unknown }) => children,
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
  // ⌘K preloads the lazy pages and the en search aliases (lib/lazyPage preloadOnIntent).
  loadEnglish: () => Promise.resolve(),
}));
vi.mock("../src/renderer/src/components/Avatar", () => ({ Avatar: ({ name }: { name: string }) => h("span", { "data-avatar": name }) }));
vi.mock("../src/renderer/src/components/HostMark", () => ({ HostDot: () => null }));
vi.mock("../src/renderer/src/lib/services", () => ({ openServiceExternal: vi.fn(async () => {}) }));
vi.mock("../src/renderer/src/lib/sideServices", () => ({ sideShowsHost: (id: string) => id === "local" }));
vi.mock("../src/renderer/src/lib/openModifiers", () => ({ isMac: () => false }));
vi.mock("../src/renderer/src/modules/quick-switch/shelfPages", () => ({ readShelfPages: () => [], showShelfPage: () => true }));
// The workspaces on screen (live.ts reads them when the palette opens) and lib/workspaces openRef (beside for services / artifacts / pages).
const ws = vi.hoisted(() => ({ panes: [{ paneId: "main", hostId: "local", sessionId: "a1" }] as { paneId: string; hostId: string; sessionId: string | null }[], openRef: null as unknown as Mock<(...args: unknown[]) => Promise<boolean>> }));
vi.mock("../src/renderer/src/lib/workspaces", () => ({ screenOf: () => ({ panes: ws.panes, focused: "main" }), openRef: (...args: unknown[]) => ws.openRef(...args), startWorkspaceDrag: () => {} }));
vi.mock("../src/renderer/src/lib/paneStore", () => ({ usePanes: { getState: () => ({ layout: {} }) } }));
// An agent row's open and preview come from lib/workspaceEffects (008: one effect for both); a service beside's preview from refEffect.
const fxEffect = vi.hoisted(() => ({ agentRuns: [] as { ref: unknown; mode: string }[], foretells: [] as unknown[] }));
vi.mock("../src/renderer/src/lib/workspaceEffects", () => ({
  agentEffect: (ref: { key: string }, mode: string) => ({ foretell: { tone: mode === "beside" ? "beside" : "replace", text: `${mode}:${ref.key}`, marks: [] }, run: () => void fxEffect.agentRuns.push({ ref, mode }) }),
  // As lib/workspaceEffects: the open is lib/workspaces openRef; nothing opened → onFail("unavailable").
  refEffect: (ref: { key: string }, mode: string, opts: { pageParams?: Record<string, string>; onFail?(r: string): void }) => ({
    foretell: { tone: "open", text: `${mode}:${ref.key}`, marks: [] },
    run: () => void ws.openRef(ref, mode, opts.pageParams ? { pageParams: opts.pageParams } : {}).then((ok) => ok || opts.onFail?.("unavailable")),
  }),
}));
vi.mock("../src/renderer/src/lib/paneKinds", () => ({ isFullWindowPage: (page: string) => page === "settings.page" }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = function () {};

const { Palette } = await import("../src/renderer/src/modules/quick-switch/Palette");
const { startQuickSwitch, isQuickSwitchOpen, closeQuickSwitch } = await import("../src/renderer/src/modules/quick-switch/live");

const agent = (id: string, title: string): QsItem => ({ id: `agent:local:${id}`, kind: "agent", title, rank: 0, hostId: "local", lead: { kind: "named", name: title }, target: { kind: "agent", hostId: "local", sessionId: id } });
const service = (slug: string): QsItem => ({ id: `service:local:${slug}`, kind: "service", title: slug, rank: 0, hostId: "local", lead: { kind: "icon", icon: Globe }, target: { kind: "service", hostId: "local", slug } });
const shelfPage = (id: string): QsItem => ({ id: `shelf:s:${id}`, kind: "shelfPage", title: `page ${id}`, rank: 0, target: { kind: "shelfPage", shelfId: "s", pageId: id } });

let root: Root | null = null;
let host: HTMLElement | null = null;
beforeEach(() => {
  ws.panes = [{ paneId: "main", hostId: "local", sessionId: "a1" }];
  ws.openRef = vi.fn(async (..._args: unknown[]) => true);
  // No Shelf pages = no 「Shelf 页」 chip.
  fx.items = [agent("a1", "alpha"), agent("a2", "beta"), service("audiobook")];
  fx.shelves = false;
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  closeQuickSwitch(false);
  document.body.innerHTML = "";
});

function mount(onOpen = vi.fn(), onClose = vi.fn(), screen?: { workspaces: number; otherHostId: string | null }) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(h(Palette, { recent: [], mac: false, onOpen, onClose, ...(screen ? { screen, showsHost: (id: string) => id === "local" } : {}) })));
  return { onOpen, onClose };
}
const press = (key: string, init: KeyboardEventInit = {}) => act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })));
const selectedTitle = () => document.querySelector("[data-qs-selected]")?.textContent ?? null;
const chips = () => [...document.querySelectorAll('[role="tab"]')].map((b) => b.textContent);
const activeChip = () => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent;
const type = (text: string) =>
  act(() => {
    const input = document.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

describe("palette keyboard", () => {
  it("focuses the field; ↓ / ↑ move the selection (wrapping); Enter opens in place, Ctrl+Enter beside", () => {
    const { onOpen } = mount();
    expect(document.activeElement?.tagName).toBe("INPUT");
    expect(selectedTitle()).toContain("alpha");
    press("ArrowDown");
    expect(selectedTitle()).toContain("beta");
    press("ArrowDown");
    expect(selectedTitle()).toContain("audiobook");
    press("ArrowDown");
    expect(selectedTitle()).toContain("alpha");
    press("ArrowUp");
    expect(selectedTitle()).toContain("audiobook");
    press("Enter");
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ id: "service:local:audiobook" }), false);
    // Canvas principles §7: a service always goes into a Shelf — beside it = a new page of the Shelf (one workspace).
    press("Enter", { ctrlKey: true });
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ id: "service:local:audiobook" }), true);
    press("ArrowUp");
    expect(selectedTitle()).toContain("beta");
    press("Enter", { ctrlKey: true });
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ title: expect.stringContaining("beta") }), true);
  });

  it("keys do not reach the rest of the window while open", () => {
    mount();
    const heard = vi.fn();
    window.addEventListener("keydown", heard);
    press("ArrowDown");
    press("Tab");
    press("a");
    window.removeEventListener("keydown", heard);
    expect(heard.mock.calls.map(([e]) => (e as KeyboardEvent).key)).toEqual(["a"]);
  });

  it("Tab / Shift+Tab cycle the scope chips (Shelf 页 only when there are Shelf pages) and filter the rows", () => {
    mount();
    expect(chips()).toEqual(["quick-switch.scope.all", "quick-switch.scope.agent", "quick-switch.scope.service", "quick-switch.scope.artifact", "quick-switch.scope.page"]);
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(3);
    press("Tab");
    expect(activeChip()).toBe("quick-switch.scope.agent");
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(2);
    press("Tab");
    expect(activeChip()).toBe("quick-switch.scope.service");
    expect(selectedTitle()).toContain("audiobook");
    press("Tab", { shiftKey: true });
    press("Tab", { shiftKey: true });
    press("Tab", { shiftKey: true });
    // Skips the hidden Shelf 页 chip: all ← page.
    expect(activeChip()).toBe("quick-switch.scope.page");
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
  });

  it("with Shelf pages: the chip shows; a Shelf page opens without beside", () => {
    fx.shelves = true;
    fx.items = [...fx.items, shelfPage("1")];
    const { onOpen } = mount();
    expect(chips()).toContain("quick-switch.scope.shelfPage");
    press("Tab", { shiftKey: true });
    expect(activeChip()).toBe("quick-switch.scope.shelfPage");
    press("Enter", { ctrlKey: true });
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "shelfPage" }), false);
  });

  it("typing filters and resets the selection; Esc and Ctrl+K close; IME Enter does nothing", () => {
    const { onOpen, onClose } = mount();
    press("ArrowDown");
    type("aud");
    expect(selectedTitle()).toContain("audiobook");
    expect(document.querySelector("mark")?.textContent).toBe("aud");
    press("Enter", { isComposing: true });
    expect(onOpen).not.toHaveBeenCalled();
    type("zzzz");
    expect(document.body.textContent).toContain("quick-switch.empty");
    press("Enter");
    expect(onOpen).not.toHaveBeenCalled();
    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    press("k", { ctrlKey: true });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("the selected row's hints say what ↵ and Ctrl+↵ do, per kind and workspace count", () => {
    const hints = () => document.querySelector("[data-qs-selected]")!.textContent!;
    const legend = () => document.querySelector('[role="dialog"] > div:last-child')!.textContent!;
    const pick = (q: string) => type(q);
    mount(vi.fn(), vi.fn(), { workspaces: 1, otherHostId: null });
    expect(hints()).toContain("quick-switch.row.replace");
    expect(hints()).toContain("quick-switch.row.sideBySide");
    expect(legend()).toContain("quick-switch.hint.sideBySide");
    pick("audio");
    expect(hints()).toContain("quick-switch.row.inShelf");
    expect(hints()).toContain("quick-switch.row.newPage");
    expect(legend()).toContain("quick-switch.hint.newPage");
    act(() => root!.unmount());
    host!.remove();
    mount(vi.fn(), vi.fn(), { workspaces: 2, otherHostId: "local" });
    pick("audio");
    expect(hints()).toContain("quick-switch.row.otherShelf");
    expect(legend()).toContain("quick-switch.hint.otherShelf");
    act(() => root!.unmount());
    host!.remove();
    // the other workspace shows another host: no beside for this service (Ctrl+↵ = ↵), no hint
    const onOpen = vi.fn();
    mount(onOpen, vi.fn(), { workspaces: 2, otherHostId: "ssh-b" });
    pick("audio");
    expect(hints()).not.toContain("quick-switch.row.otherShelf");
    expect(legend()).not.toContain("Ctrl ↵");
    press("Enter", { ctrlKey: true });
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ id: "service:local:audiobook" }), false);
  });

  it("click opens; Ctrl+click opens beside", () => {
    const { onOpen } = mount();
    const rows = document.querySelectorAll('[role="option"]');
    act(() => void rows[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ id: "agent:local:a2" }), false);
    act(() => void rows[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true })));
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ id: "agent:local:a1" }), true);
  });
});

describe("module: Ctrl+K and opens", () => {
  function fakeCtx() {
    const prefs = new Map<string, unknown>();
    const controller = new AbortController();
    const ctx = {
      id: "quick-switch",
      signal: controller.signal,
      generation: 1,
      host: { id: "local", kind: "local", features: new Set<string>() },
      contribute: () => () => {},
      prefs: { get: (k: string, f: unknown) => (prefs.has(k) ? prefs.get(k) : f), set: (k: string, v: unknown) => void prefs.set(k, v), subscribe: () => () => {} },
      t: (k: string, vars?: Record<string, unknown>) => (vars ? `${k}:${JSON.stringify(vars)}` : k),
      services: {
        panes: { open: vi.fn(() => ({ status: "opened", kind: "x", paneId: "p", instanceId: null })) },
        refs: { open: vi.fn(async () => ({ status: "opened", where: "card" })) },
        ui: { notice: vi.fn() },
      },
    };
    return { ctx, prefs, controller };
  }
  const ctrlK = () => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true, bubbles: true, cancelable: true })));
  const flush = () => act(async () => {});

  it("Ctrl+K opens the palette over the window; Enter opens the agent in place, Ctrl+Enter beside (lib/workspaceEffects agentEffect); recents recorded", async () => {
    const { ctx, prefs, controller } = fakeCtx();
    startQuickSwitch(ctx as never);
    ctrlK();
    expect(isQuickSwitchOpen()).toBe(true);
    expect(document.querySelector("[data-quick-switch] [role=dialog]")).not.toBeNull();
    press("ArrowDown");
    press("Enter");
    await flush();
    expect(isQuickSwitchOpen()).toBe(false);
    expect(fxEffect.agentRuns.at(-1)).toEqual({ ref: { hostId: "local", key: "a2", title: "beta" }, mode: "replace" });
    expect((prefs.get("recent") as { id: string }[])[0]!.id).toBe("agent:local:a2");

    ctrlK();
    // The recent agent is on top now.
    expect(selectedTitle()).toContain("beta");
    press("Enter", { ctrlKey: true });
    await flush();
    expect(fxEffect.agentRuns.at(-1)).toEqual({ ref: { hostId: "local", key: "a2", title: "beta" }, mode: "beside" });

    ctrlK();
    type("audio");
    press("Enter");
    await flush();
    expect(ctx.services.panes.open).toHaveBeenLastCalledWith("browser.service", { url: "cutex:service/audiobook/" }, { focus: true });

    // Ctrl+Enter on a service: lib/workspaces openRef "beside" (a new Shelf page with one workspace, the other's Shelf with two).
    const panesCalls = ctx.services.panes.open.mock.calls.length;
    ctrlK();
    type("audio");
    press("Enter", { ctrlKey: true });
    await flush();
    expect(ws.openRef).toHaveBeenLastCalledWith({ kind: "service", hostId: "local", key: "audiobook", title: "audiobook" }, "beside", {});
    expect(ctx.services.panes.open.mock.calls.length).toBe(panesCalls);
    ws.panes = [...ws.panes, { paneId: "c2", hostId: "local", sessionId: "a2" }];
    ws.openRef.mockResolvedValueOnce(false);
    ctrlK();
    type("audio");
    press("Enter", { ctrlKey: true });
    await flush();
    expect(ws.openRef).toHaveBeenCalledTimes(2);
    expect(ctx.services.ui.notice).toHaveBeenLastCalledWith('quick-switch.failed:{"name":"audiobook","reason":"quick-switch.notOpened"}', "error");

    // A handled key (e.g. a focused terminal's Ctrl+K) is left alone.
    act(() => {
      const e = new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true, bubbles: true, cancelable: true });
      e.preventDefault();
      window.dispatchEvent(e);
    });
    expect(isQuickSwitchOpen()).toBe(false);

    // Stopping the module removes the shortcut and closes an open palette.
    ctrlK();
    expect(isQuickSwitchOpen()).toBe(true);
    act(() => controller.abort());
    expect(isQuickSwitchOpen()).toBe(false);
    ctrlK();
    expect(isQuickSwitchOpen()).toBe(false);
  });

  it("says why an open failed", async () => {
    const { ctx, controller } = fakeCtx();
    ctx.services.panes.open.mockReturnValue({ status: "unavailable", reason: "host-offline" } as never);
    fx.items = [{ id: "page:x.list", kind: "page", title: "list", rank: 0, lead: { kind: "icon", icon: Globe }, target: { kind: "page", page: "x.list" } }];
    startQuickSwitch(ctx as never);
    ctrlK();
    press("Enter");
    await flush();
    expect(ctx.services.ui.notice).toHaveBeenCalledWith('quick-switch.failed:{"name":"list","reason":"host-offline"}', "error");
    act(() => controller.abort());
  });

  it("foretells the selected row after the delay (Ctrl held: the beside one), from the effect its open runs; gone on close", async () => {
    const { useForetellStore } = await import("../src/renderer/src/lib/foretell");
    const { ctx, controller } = fakeCtx();
    vi.useFakeTimers();
    try {
      startQuickSwitch(ctx as never);
      ctrlK();
      expect(useForetellStore.getState().shown).toBeNull();
      act(() => void vi.advanceTimersByTime(200));
      expect(useForetellStore.getState().shown?.text).toBe("replace:a1");
      press("ArrowDown");
      act(() => void vi.advanceTimersByTime(200));
      expect(useForetellStore.getState().shown?.text).toBe("replace:a2");
      act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true })));
      act(() => void vi.advanceTimersByTime(200));
      expect(useForetellStore.getState().shown).toMatchObject({ tone: "beside", text: "beside:a2" });
      act(() => void window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" })));
      // A service in place opens as a Shelf tab (no foretell); beside goes through openRef = refEffect's preview.
      type("audio");
      act(() => void vi.advanceTimersByTime(200));
      expect(useForetellStore.getState().shown).toBeNull();
      act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true })));
      act(() => void vi.advanceTimersByTime(200));
      expect(useForetellStore.getState().shown?.text).toBe("beside:audiobook");
      press("Escape");
      expect(isQuickSwitchOpen()).toBe(false);
      expect(useForetellStore.getState().shown).toBeNull();
    } finally {
      vi.useRealTimers();
      act(() => controller.abort());
    }
  });
});
