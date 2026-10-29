// @vitest-environment jsdom
// Both workspaces' Shelves live side by side (owner 2026-10-21; docs/desktop-modules.md §24.13): the other
// workspace's Shelf renders its real panes and its instances stay mounted (no still card, no remount on a focus
// switch); a follow-bound tool binds to its own workspace's conversation; shortcuts act on the focused workspace's
// Shelf; a pane dragged from one workspace's Shelf to the other's moves with its instance (no remount); a press in
// the other workspace's Shelf gives it the focus first.
import { act, createElement as h, useContext, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SideBodyProps } from "../src/renderer/src/modules/slots";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));

// The test component: records its mounts / unmounts and the conversation its binding resolves to.
const env = vi.hoisted(() => ({
  mounts: [] as string[],
  unmounts: [] as string[],
  seen: {} as Record<string, string | null>,
}));
function ToolBody(props: SideBodyProps<unknown>) {
  const id = props.instance.id;
  useEffect(() => {
    env.mounts.push(id);
    return () => void env.unmounts.push(id);
  }, [id]);
  env.seen[id] = props.sessionId;
  return h("div", { "data-tool-body": id, "data-tool-session": props.sessionId ?? "" });
}
const TOOL = "test.tool";
const NONE: never[] = [];
const SIDE = [
  {
    mode: "show",
    moduleId: "test",
    item: { id: TOOL, titleKey: "side.column", icon: () => null, instances: "multi", defaultBinding: "follow", placement: { home: "chat" }, Body: ToolBody, useTab: () => ({ title: "Tool" }) },
  },
];
vi.mock("../src/renderer/src/modules/app", () => ({
  appModules: () => ({
    subscribe: () => () => {},
    snapshot: (slot: string) => (slot === "side.component" ? SIDE : NONE),
    statuses: () => new Map(),
    modules: [],
  }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { SessionResource } from "@cutex-desktop/protocol";
import type { ItemId } from "../src/renderer/src/modules/types";
import { applyOpen, emptyLayout, findPage, locate, mergePageInto, moveToNewShelf, place, placeSpec, shelvesOf, addShelfPage, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { conversationPanes, defaultLayout, focusPane, openBeside } from "../src/renderer/src/lib/paneLayout";
import { usePanes } from "../src/renderer/src/lib/paneStore";
import { closeInstancesAnywhere, flushSideSave, movePageToPeer, movePaneToPeer, peerDropTarget, peerPageDropTarget, resetConvShelves, shelfDropKeys, shelfDropSnapshot, undoShelfDrop, setInstanceStateNow, startSideStore, switchConversation, useSide } from "../src/renderer/src/lib/sideLayoutStore";
import { renumber } from "../src/renderer/src/lib/convShelves";
import { readConvShelf, writeConvShelf } from "../src/renderer/src/lib/paneFile";
import { applyCrossDrop } from "../src/renderer/src/lib/sideDrop";
import { switchShelfPage } from "../src/renderer/src/lib/sideActions";
import { useApp } from "../src/renderer/src/store";
import * as appearance from "../src/renderer/src/lib/appearance";
import { DEFAULT_APPEARANCE } from "../src/renderer/src/lib/appearanceModel";
import { resetRowDrag, useRowDrag } from "../src/renderer/src/lib/rowDrag";
import * as glide from "../src/renderer/src/lib/columnGlide";
import * as slots from "../src/renderer/src/lib/sideSlots";
import { WsRowContext } from "../src/renderer/src/lib/workspaceRowView";

const { SideWorkArea } = await import("../src/renderer/src/components/side/SideArea");
const { SideInstanceLayer } = await import("../src/renderer/src/components/side/SideInstanceLayer");

let clock = 100;
/** A layout with one more follow-bound tool (a pane of its own on the page in view, or a new page). */
function withTool(l: SideLayout = emptyLayout()): SideLayout {
  const input = { kind: TOOL as ItemId, binding: { kind: "follow" as const, hostId: "local" }, key: null, state: { n: clock } as never, v: 1, pinned: true };
  const decision = place(l, { ...input, transient: false, activePage: l.activePage, columnOpen: l.open }, placeSpec({ home: "chat" }));
  return applyOpen(l, decision, input, ++clock, { reveal: true, home: "chat" }).layout;
}
const session = (id: string, name: string) => ({ cutexSessionId: id, displayName: name, avatar: null, native: { threadId: null }, runtime: { status: "online" }, cwd: "" }) as unknown as SessionResource;

let root: Root;
let container: HTMLElement;
const q = (sel: string) => container.querySelector<HTMLElement>(sel);
const layer = (sel: string) => document.querySelector<HTMLElement>(sel);

function Columns() {
  const row = useContext(WsRowContext);
  return h("i", { "data-row-widths": row ? row.widths.join(",") : "none" });
}
const widths = () => q("[data-row-widths]")!.dataset.rowWidths!.split(",").map(Number);

function render(split: { focused: number } | null) {
  act(() =>
    root.render(
      h("div", null, h(SideWorkArea, { side: true, split, single: split ? null : "main", children: h(Columns) }), h(SideInstanceLayer)),
    ),
  );
}

/** Two panes: eva (left) and alden (right); `focused` = which one has the focus (the selection follows). */
function twoPanes(focused: 0 | 1) {
  let work = usePanes.getState().layout;
  if (conversationPanes(work).length !== 2) {
    work = defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" });
    work = openBeside(work, { hostId: "local", sessionId: "alden" }, 1);
  }
  work = focusPane(work, conversationPanes(work)[focused]!, 2);
  act(() => {
    usePanes.setState({ layout: work });
    useApp.setState({ selectedId: focused === 0 ? "eva" : "alden" });
    switchConversation(focused === 0 ? "local|eva" : "local|alden");
  });
}

/**
 * alden's own Shelf (stored): one follow-bound tool (`pages` pages of one each), ids clear of eva's — but with
 * `sameShelfId`, its Shelf has the id of eva's (as conversations made from the same default layout, or sharing a
 * page, do: Shelf ids are unique per conversation only).
 */
function aldenShelf(pages = 1, sameShelfId = false): string[] {
  let own = withTool(emptyLayout());
  for (let i = 1; i < pages; i++) {
    const made = addShelfPage(own, shelvesOf(own)[0]!.id);
    own = withTool({ ...made.layout, activePage: made.pageId });
  }
  own = renumber(own, 500).layout;
  if (sameShelfId) {
    const [from, to] = [shelvesOf(own)[0]!.id, shelvesOf(useSide.getState().layout)[0]!.id];
    own = { ...own, shelves: shelvesOf(own).map((x) => (x.id === from ? { ...x, id: to } : x)), pages: own.pages.map((p) => (p.shelf === from ? { ...p, shelf: to } : p)) };
  }
  writeConvShelf("host:local", "local|alden", own, { open: true }, null);
  return Object.keys(own.instances);
}

const toolId = (l: SideLayout) => Object.keys(l.instances)[0]!;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  env.mounts = [];
  env.unmounts = [];
  env.seen = {};
  glide.resetColumnGlide();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-side-work") ? 2400 : 0;
  });
  localStorage.clear();
  resetConvShelves();
  useApp.setState({ selectedId: "eva", selectedHost: null, hosts: null, sidebar: { active: [session("eva", "Eva"), session("alden", "Alden")], retired: [], hostRows: {}, projects: null } as never });
  useSide.setState({ scope: "host:local", layout: withTool(), mode: null, narrow: false, liveWidth: {}, tabInfo: {}, focusedCard: null });
  useRowDrag.setState({ lead: null, leadShare: null, colW: [null, null] });
  resetRowDrag({ columns: true });
  appearance.setAppearance({ ...DEFAULT_APPEARANCE }, false);
  usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
  act(() => switchConversation("local|eva"));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  glide.resetColumnGlide();
});

describe("both workspaces' Shelves are live", () => {
  it("a position-only animation commits the body's new box before the animation frame returns, without remounting", () => {
    let left = 100;
    vi.spyOn(slots, "slotBox").mockImplementation(() => ({ rect: { left, top: 80, width: 400, height: 600 }, clip: { left, top: 80, width: 400, height: 600 } }));
    const frames = new Map<number, FrameRequestCallback>();
    let seq = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => (frames.set(++seq, cb), seq));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    render(null);
    const id = toolId(useSide.getState().layout);
    const body = layer(`[data-tool-body="${id}"]`)!;
    const box = layer(`[data-side-instance="${id}"]`)!;
    expect(box.style.left).toBe("100px");
    // A translate does not resize the placeholder: only the motion follower can keep the body aligned.
    left = 180;
    act(() => slots.slotsMotion());
    act(() => {
      for (const [id, cb] of [...frames]) {
        frames.delete(id);
        cb(16);
      }
      // Check inside the callback's task, before act flushes deferred React updates.
      expect(box.style.left).toBe("180px");
    });
    expect(layer(`[data-tool-body="${id}"]`)).toBe(body);
    expect(env.unmounts).toEqual([]);
  });

  it("the other workspace's Shelf renders its real panes (no still card) and its instance is mounted", () => {
    const aldenTool = aldenShelf()[0]!;
    const evaTool = toolId(useSide.getState().layout);
    twoPanes(0);
    render({ focused: 0 });
    const peer = q("[data-ws-shelf-box][data-ws-peer]")!;
    expect(peer.dataset.wsPeer).toBe("local|alden");
    // A real pane (its placeholder), not a resting card.
    expect(peer.querySelector("[data-side-card]")).not.toBeNull();
    expect(q("[data-ws-dormant]")).toBeNull();
    // Both instances mounted in the instance layer.
    expect(layer(`[data-tool-body="${evaTool}"]`)).not.toBeNull();
    expect(layer(`[data-tool-body="${aldenTool}"]`)).not.toBeNull();
    expect(new Set(env.mounts)).toEqual(new Set([evaTool, aldenTool]));
  });

  it("a follow-bound tool binds to its own workspace's conversation, whichever workspace has the focus", () => {
    const aldenTool = aldenShelf()[0]!;
    const evaTool = toolId(useSide.getState().layout);
    twoPanes(0);
    render({ focused: 0 });
    expect(env.seen[evaTool]).toBe("eva");
    expect(env.seen[aldenTool]).toBe("alden");
    twoPanes(1);
    render({ focused: 1 });
    expect(env.seen[evaTool]).toBe("eva");
    expect(env.seen[aldenTool]).toBe("alden");
    expect(layer(`[data-tool-body="${evaTool}"]`)!.dataset.toolSession).toBe("eva");
  });

  it("a focus switch keeps every instance mounted (same DOM node, no remount) and swaps which Shelf is the live layout", () => {
    const aldenTool = aldenShelf()[0]!;
    const evaTool = toolId(useSide.getState().layout);
    twoPanes(0);
    render({ focused: 0 });
    const evaNode = layer(`[data-tool-body="${evaTool}"]`);
    const aldenNode = layer(`[data-tool-body="${aldenTool}"]`);
    const peerBox = q("[data-ws-peer]");
    twoPanes(1);
    render({ focused: 1 });
    twoPanes(0);
    render({ focused: 0 });
    twoPanes(1);
    render({ focused: 1 });
    expect(env.unmounts).toEqual([]);
    expect(env.mounts.sort()).toEqual([aldenTool, evaTool].sort());
    expect(layer(`[data-tool-body="${evaTool}"]`)).toBe(evaNode);
    expect(layer(`[data-tool-body="${aldenTool}"]`)).toBe(aldenNode);
    // alden's Shelf is now the live layout, eva's the peer; alden's box stayed the same element.
    expect(useSide.getState().layout.instances[aldenTool]).toBeTruthy();
    expect(useSide.getState().peers["local|eva"]!.own.instances[evaTool]).toBeTruthy();
    expect(q(`[data-ws-shelf-box]:not([data-ws-peer])`)).toBe(peerBox);
    expect(q("[data-ws-peer]")!.dataset.wsPeer).toBe("local|eva");
  });

  it("the other workspace's instances keep their state and close in their own Shelf", () => {
    const aldenTool = aldenShelf()[0]!;
    twoPanes(0);
    render({ focused: 0 });
    act(() => setInstanceStateNow(aldenTool, { url: "x" } as never, 1));
    expect(useSide.getState().peers["local|alden"]!.own.instances[aldenTool]!.state).toEqual({ url: "x" });
    expect(useSide.getState().layout.instances[aldenTool]).toBeUndefined();
    act(() => closeInstancesAnywhere([aldenTool]));
    expect(useSide.getState().peers["local|alden"]!.own.instances[aldenTool]).toBeUndefined();
    render({ focused: 0 });
    expect(env.unmounts).toEqual([aldenTool]);
  });
});

describe("two Shelves of the same id (one per conversation)", () => {
  // Owner 2026-10-21 (after d2ab9da0): selecting the left conversation, its Shelf Rail was gone. The two workspaces'
  // Shelf boxes are siblings in the row and were keyed by the Shelf's id alone — unique within a conversation
  // only (each conversation's first Shelf is `s1` in the mock preview). With two equal keys React kept a stale
  // box, drew one Shelf twice and dropped another as the row's Shelves changed. Now keyed by conversation + id.
  const boxes = () => [...container.querySelectorAll<HTMLElement>("[data-ws-shelf-box]")].map((b) => `${b.dataset.wsPeer ?? "live"}:${b.dataset.wsShelfBox}:${b.querySelector("[data-shelf-rail]") ? "rail" : "-"}`);

  it("selecting the left conversation keeps every Shelf box and rail — once each, the same element", () => {
    const err = vi.spyOn(console, "error");
    aldenShelf(1, true);
    const s1 = shelvesOf(useSide.getState().layout)[0]!.id;
    twoPanes(1);
    render({ focused: 1 });
    expect(boxes()).toEqual([`local|eva:${s1}:rail`, `live:${s1}:rail`]);
    const [evaBox, aldenBox] = [...container.querySelectorAll("[data-ws-shelf-box]")];
    // Select the left conversation: its Shelf is the live layout now, in the same box.
    twoPanes(0);
    render({ focused: 0 });
    expect(boxes()).toEqual([`live:${s1}:rail`, `local|alden:${s1}:rail`]);
    expect([...container.querySelectorAll("[data-ws-shelf-box]")]).toEqual([evaBox, aldenBox]);
    // It gets a second Shelf (left of its first): three boxes, each Shelf once with its rail.
    act(() =>
      useSide.setState((st) => {
        const l = withTool(st.layout);
        return { layout: moveToNewShelf(l, { instance: Object.keys(l.instances).at(-1)! }, "left", 5) };
      }),
    );
    render({ focused: 0 });
    const s2 = shelvesOf(useSide.getState().layout).find((x) => x.side === "left")!.id;
    expect(boxes()).toEqual([`live:${s2}:rail`, `live:${s1}:rail`, `local|alden:${s1}:rail`]);
    // And back to the right one, and left again: still each once (before: a stale copy of the left Shelf's box
    // stayed in the row, another was dropped).
    twoPanes(1);
    render({ focused: 1 });
    expect(boxes()).toEqual([`local|eva:${s2}:rail`, `local|eva:${s1}:rail`, `live:${s1}:rail`]);
    twoPanes(0);
    render({ focused: 0 });
    expect(boxes()).toEqual([`live:${s2}:rail`, `live:${s1}:rail`, `local|alden:${s1}:rail`]);
    expect(container.querySelector(`[data-ws-shelf-box]:not([data-ws-peer])`)!.querySelector("[data-shelf-rail]")).not.toBeNull();
    expect(err.mock.calls.filter((c) => String(c[0]).includes("same key"))).toEqual([]);
    expect(env.unmounts).toEqual([]);
  });
});

describe("shortcuts act on the focused workspace's Shelf", () => {
  it("Alt+n switches the focused Shelf's page, not the other workspace's", () => {
    aldenShelf(2);
    // eva: two pages too.
    act(() =>
      useSide.setState((s) => {
        const made = addShelfPage(s.layout, shelvesOf(s.layout)[0]!.id);
        return { layout: withTool({ ...made.layout, activePage: made.pageId }) };
      }),
    );
    twoPanes(0);
    render({ focused: 0 });
    const peerBefore = useSide.getState().peers["local|alden"]!;
    const aldenActive = shelvesOf(peerBefore.own)[0]!.active;
    const evaShelf = shelvesOf(useSide.getState().layout)[0]!;
    const first = useSide.getState().layout.pages.find((p) => p.shelf === evaShelf.id)!.id;
    act(() => void switchShelfPage(1));
    expect(shelvesOf(useSide.getState().layout)[0]!.active).toBe(first);
    // The other workspace's Shelf did not change.
    expect(useSide.getState().peers["local|alden"]).toBe(peerBefore);
    expect(shelvesOf(useSide.getState().peers["local|alden"]!.own)[0]!.active).toBe(aldenActive);
  });

  it("a press in the other workspace's Shelf gives that workspace the focus first (its Shelf becomes the live one)", () => {
    const aldenTool = aldenShelf()[0]!;
    const stop = startSideStore(() => () => {});
    try {
      useApp.setState({ openAgent: async (id: string) => void useApp.setState({ selectedId: id }) } as never);
      twoPanes(0);
      render({ focused: 0 });
      const peer = q("[data-ws-peer]")!;
      act(() => peer.querySelector("[data-side-card]")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
      expect(useApp.getState().selectedId).toBe("alden");
      expect(useSide.getState().layout.instances[aldenTool]).toBeTruthy();
      render({ focused: 1 });
      expect(env.unmounts).toEqual([]);
      // Now Alt+1 acts on alden's Shelf (the focused one).
      act(() => void switchShelfPage(1));
      expect(shelvesOf(useSide.getState().layout)[0]!.active).toBe(locate(useSide.getState().layout, aldenTool)!.page.id);
    } finally {
      stop();
    }
  });
});

describe("the other workspace's Shelf edge (宽度规则 still hold)", () => {
  it("a drag on its edge gives it the focus and changes only that Shelf and its own column", () => {
    aldenShelf();
    (HTMLElement.prototype as unknown as { setPointerCapture(): void }).setPointerCapture = () => {};
    const stop = startSideStore(() => () => {});
    try {
      useApp.setState({ openAgent: async (id: string) => void useApp.setState({ selectedId: id }) } as never);
      twoPanes(0);
      render({ focused: 0 });
      const [a, b] = widths();
      const seam = q("[data-ws-peer] [role='separator']")!;
      const pointer = (type: string, x: number) => new MouseEvent(type, { bubbles: true, clientX: x, button: 0 });
      // alden's Shelf is at the right edge: its seam on its left; dragging left grows it.
      act(() => seam.dispatchEvent(pointer("pointerdown", 1500)));
      expect(useApp.getState().selectedId).toBe("alden");
      render({ focused: 1 });
      act(() => seam.dispatchEvent(pointer("pointermove", 1440)));
      expect(widths()).toEqual([a, b! - 60]);
      act(() => seam.dispatchEvent(pointer("pointerup", 1440)));
      expect(widths()).toEqual([a, b! - 60]);
      expect(shelvesOf(useSide.getState().layout)[0]!.width).toBe(DEFAULT_APPEARANCE.sidePaneWidth + 60);
    } finally {
      stop();
    }
  });
});

describe("drag a pane from one workspace's Shelf to the other's", () => {
  it("pure: the pane leaves the focused Shelf and lands on the other's page in view, same instance id", () => {
    const from = withTool();
    const to = renumber(withTool(), 500).layout;
    const id = toolId(from);
    const card = locate(from, id)!.card.id;
    const page = shelvesOf(to)[0]!.active!;
    const out = applyCrossDrop(from, to, { type: "card", cardId: card }, { kind: "page", pageId: page }, 1, () => 500, 900)!;
    expect(out.from.instances[id]).toBeUndefined();
    expect(out.to!.instances[id]).toBeTruthy();
    expect(locate(out.to!, id)!.page.id).toBe(page);
    expect(findPage(out.to!, "p:carry")).toBeNull();
  });

  it("store + layer: the instance moves to the other workspace's Shelf without remounting; the focus stays", () => {
    const aldenTool = aldenShelf()[0]!;
    const evaTool = toolId(useSide.getState().layout);
    twoPanes(0);
    render({ focused: 0 });
    const node = layer(`[data-tool-body="${evaTool}"]`);
    const peer = useSide.getState().peers["local|alden"]!;
    const page = locate(peer.own, aldenTool)!.page.id;
    const drag = { type: "tab" as const, instanceId: evaTool };
    const target = peerDropTarget("local|alden", drag, { at: "page", pageId: page }, true);
    expect(target).toEqual({ kind: "page", pageId: page });
    act(() => void movePaneToPeer("local|alden", drag, target!, 5, () => 500));
    render({ focused: 0 });
    expect(useSide.getState().layout.instances[evaTool]).toBeUndefined();
    expect(locate(useSide.getState().peers["local|alden"]!.own, evaTool)!.page.id).toBe(page);
    expect(useApp.getState().selectedId).toBe("eva");
    // Same node, never unmounted; now drawn in alden's Shelf and bound to alden (it follows its Shelf's conversation).
    // (alden's own tool became a background tab of the same pane: it unmounts like any hidden tab of its kind.)
    expect(env.unmounts).not.toContain(evaTool);
    expect(layer(`[data-tool-body="${evaTool}"]`)).toBe(node);
    expect(env.seen[evaTool]).toBe("alden");
    // And stored with alden's Shelf (gone from eva's).
    act(() => flushSideSave());
    expect(readConvShelf("host:local", "local|alden").own!.instances[evaTool]).toBeTruthy();
    expect(readConvShelf("host:local", "local|eva").own?.instances[evaTool]).toBeUndefined();
  });

  it("a pane bound to the focused agent is refused (it would vanish in the other conversation's Shelf)", () => {
    aldenShelf();
    const input = { kind: TOOL as ItemId, binding: { kind: "agent" as const, hostId: "local", sessionId: "eva" }, key: null, state: null as never, v: 1, pinned: true };
    act(() =>
      useSide.setState((s) => {
        const decision = place(s.layout, { ...input, transient: false, activePage: s.layout.activePage, columnOpen: true }, placeSpec({ home: "chat" }));
        return { layout: applyOpen(s.layout, decision, input, ++clock, { reveal: true, home: "chat" }).layout };
      }),
    );
    twoPanes(0);
    render({ focused: 0 });
    const bound = Object.entries(useSide.getState().layout.instances).find(([, i]) => i.binding.kind === "agent")![0];
    const page = shelvesOf(useSide.getState().peers["local|alden"]!.own)[0]!.active!;
    expect(peerDropTarget("local|alden", { type: "tab", instanceId: bound }, { at: "page", pageId: page }, true)).toEqual({ kind: "refuse", why: "bound" });
  });
});

// Audit 2026-10-23 #1 / #6: a whole page onto the other workspace's Shelf Rail, and the drop's 撤销.
describe("drag a page onto the other workspace's Shelf Rail", () => {
  it("＋ there: the page moves to that Shelf with its instance (no remount), the focus stays; 撤销 brings it back", () => {
    aldenShelf();
    const evaTool = toolId(useSide.getState().layout);
    twoPanes(0);
    render({ focused: 0 });
    const node = layer(`[data-tool-body="${evaTool}"]`);
    const evaPage = locate(useSide.getState().layout, evaTool)!.page.id;
    const aldenShelfId = shelvesOf(useSide.getState().peers["local|alden"]!.own)[0]!.id;
    const target = peerPageDropTarget("local|alden", evaPage, { at: "newPage", shelfId: aldenShelfId });
    expect(target).toEqual({ kind: "movePage", pageId: evaPage, shelfId: aldenShelfId, before: null });
    const before = shelfDropSnapshot("local|alden");
    act(() => void movePageToPeer("local|alden", target!));
    render({ focused: 0 });
    expect(useSide.getState().layout.instances[evaTool]).toBeUndefined();
    const there = useSide.getState().peers["local|alden"]!.own;
    expect(locate(there, evaTool)).toBeTruthy();
    expect(shelvesOf(there)[0]!.active).toBe(locate(there, evaTool)!.page.id);
    expect(useApp.getState().selectedId).toBe("eva");
    expect(env.unmounts).not.toContain(evaTool);
    expect(layer(`[data-tool-body="${evaTool}"]`)).toBe(node);
    // 撤销: back on eva's Shelf, gone from alden's — the same instance.
    const after = shelfDropKeys(before);
    act(() => void expect(undoShelfDrop(before, after)).toBe(true));
    render({ focused: 0 });
    expect(locate(useSide.getState().layout, evaTool)!.page.id).toBe(evaPage);
    expect(locate(useSide.getState().peers["local|alden"]!.own, evaTool)).toBeNull();
    expect(env.unmounts).not.toContain(evaTool);
  });

  it("撤销 is refused once something else was rearranged since the drop", () => {
    aldenShelf();
    act(() =>
      useSide.setState((s) => {
        const made = addShelfPage(s.layout, shelvesOf(s.layout)[0]!.id);
        return { layout: withTool({ ...made.layout, activePage: made.pageId }) };
      }),
    );
    twoPanes(0);
    render({ focused: 0 });
    const live = useSide.getState().layout;
    const [first, second] = live.pages;
    const before = shelfDropSnapshot(null);
    act(() => useSide.setState({ layout: mergePageInto(live, second!.id, first!.id) }));
    const after = shelfDropKeys(before);
    act(() => useSide.setState((s) => ({ layout: { ...s.layout, open: false } })));
    expect(undoShelfDrop(before, after)).toBe(false);
  });
});
