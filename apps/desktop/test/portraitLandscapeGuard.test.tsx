// @vitest-environment jsdom
// Portrait P1 guard (owner 2026-10-30, design .claude/previews/portrait/design.md): with portrait inactive the landscape
// work row must stay byte-identical — no DOM, class, style or state change. The snapshot file next to this test was
// recorded from main (a637fa8d7) BEFORE lib/portrait existed: every representative layout (one workspace by content /
// filling / narrow drawer, a collapsed Shelf, a closed tool area's rails, an empty Shelf's rail, two workspaces, a
// maximised conversation, 最大化保持; P3: left + right Shelves, a conversation maximised beside another workspace) renders the same markup and leaves the same layout state (the solver's widths are
// in the markup: data-ws-area, data-single-w, inline widths / paddings). Imports nothing of lib/portrait on purpose.
import { act, createElement as h, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
  translate: (key: string) => key,
}));
const ctx = { hostId: "local", sessionId: "eva", workspaceKey: null, available: () => true };
vi.mock("../src/renderer/src/lib/sideComponents", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSideView: () => ctx,
  sideViewNow: () => ctx,
  useSideRegistry: () => new Map(),
  sideRegistry: () => new Map(),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { SessionResource } from "@cutex-desktop/protocol";
import type { SideBinding } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import { applyOpen, collapseShelf, emptyLayout, moveToNewShelf, place, placeSpec, setOpen, shelvesOf, SINGLETON_KEY, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { conversationPanes, defaultLayout, focusPane, openBeside, toggleMaximized, type PaneLayout } from "../src/renderer/src/lib/paneLayout";
import { usePanes } from "../src/renderer/src/lib/paneStore";
import { resetConvShelves, switchConversation, useSide } from "../src/renderer/src/lib/sideLayoutStore";
import { useApp } from "../src/renderer/src/store";
import * as appearance from "../src/renderer/src/lib/appearance";
import { DEFAULT_APPEARANCE, type Appearance } from "../src/renderer/src/lib/appearanceModel";
import { useRowDrag } from "../src/renderer/src/lib/rowDrag";
import { useFillRatios } from "../src/renderer/src/lib/fillStore";
import { WsRowContext } from "../src/renderer/src/lib/workspaceRowView";
import * as glide from "../src/renderer/src/lib/columnGlide";

const { SideWorkArea } = await import("../src/renderer/src/components/side/SideArea");

let clock = 100;
const host: SideBinding = { kind: "host", hostId: "local" };
function withBrowser(l: SideLayout = emptyLayout()): SideLayout {
  const input = { kind: "browser.tab" as ItemId, binding: host, key: SINGLETON_KEY, state: { url: "https://example.com" } as never, v: 1, pinned: false };
  const decision = place(l, { ...input, transient: false, activePage: l.activePage, columnOpen: l.open }, placeSpec({ home: "browser" }));
  return applyOpen(l, decision, input, ++clock, { reveal: true, home: "browser" }).layout;
}
/** P3 cases: a second tool moved to a left Shelf of its own (left + right Shelves). */
function withLeftRight(): SideLayout {
  const l = withBrowser();
  const input = { kind: "browser.tab" as ItemId, binding: host, key: "left", state: { url: "https://example.org" } as never, v: 1, pinned: false };
  const decision = place(l, { ...input, transient: false, activePage: l.activePage, columnOpen: l.open }, placeSpec({ home: "browser" }));
  const next = applyOpen(l, decision, input, ++clock, { reveal: true, home: "browser" }).layout;
  const id = Object.keys(next.instances).find((k) => !(k in l.instances))!;
  return moveToNewShelf(next, { instance: id }, "left", ++clock);
}
const session = (id: string, name: string) => ({ cutexSessionId: id, displayName: name, avatar: null, native: { threadId: null }, runtime: { status: "online" }, cwd: "" }) as unknown as SessionResource;

let root: Root;
let container: HTMLElement;
let area = 1600;
let resize: (() => void) | null = null;

function onePane(): PaneLayout {
  return defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" });
}
function twoPanes(): PaneLayout {
  let work = onePane();
  work = openBeside(work, { hostId: "local", sessionId: "alden" }, 1);
  return focusPane(work, conversationPanes(work)[0]!, 2);
}
function Columns() {
  const row = useContext(WsRowContext);
  return h("i", { "data-row-widths": row ? row.widths.join(",") : "none" });
}

interface Scenario {
  name: string;
  area: number;
  panes: () => PaneLayout;
  side: () => SideLayout;
  look?: Partial<Appearance>;
  split?: boolean;
  covered?: boolean;
}

const SCENARIOS: Scenario[] = [
  { name: "one workspace, Shelf expanded, smart", area: 1600, panes: onePane, side: () => withBrowser() },
  { name: "one workspace, Shelf expanded, by content, wide", area: 2200, panes: onePane, side: () => withBrowser(), look: { workspaceWidth: "content" } },
  { name: "one workspace, Shelf expanded, filling", area: 1600, panes: onePane, side: () => withBrowser(), look: { workspaceWidth: "fill" } },
  { name: "one workspace, narrow window (drawer)", area: 480, panes: onePane, side: () => withBrowser() },
  { name: "one workspace, Shelf collapsed", area: 1600, panes: onePane, side: () => { const l = withBrowser(); return collapseShelf(l, shelvesOf(l)[0]!.id); } },
  { name: "one workspace, tool area closed (rails)", area: 1600, panes: onePane, side: () => setOpen(withBrowser(), false) },
  { name: "one workspace, empty Shelf (empty rail)", area: 1600, panes: onePane, side: () => emptyLayout() },
  { name: "one workspace, rail inner", area: 1600, panes: onePane, side: () => withBrowser(), look: { shelfRailPlacement: "inner" } },
  { name: "two workspaces", area: 1800, panes: twoPanes, side: () => withBrowser(), split: true },
  { name: "maximised conversation", area: 1600, panes: onePane, side: () => withBrowser(), covered: true },
  { name: "最大化保持", area: 1600, panes: onePane, side: () => withBrowser(), look: { fillMode: true } },
  // P3 (recorded on a637fa8d7 too): left + right Shelves; a conversation maximised beside another workspace (its rail).
  { name: "one workspace, left and right Shelves", area: 1600, panes: onePane, side: withLeftRight },
  { name: "maximised conversation beside another workspace", area: 1800, panes: () => { const l = twoPanes(); return toggleMaximized(l, conversationPanes(l)[0]!); }, side: () => withBrowser(), covered: true },
];

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  glide.resetColumnGlide();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        resize = cb;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-side-work") ? area : 0;
  });
  localStorage.clear();
  resetConvShelves();
  useFillRatios.setState({ scopes: {} });
  useRowDrag.setState({ lead: null, leadShare: null, colW: [null, null] });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  glide.resetColumnGlide();
  appearance.setAppearance({ ...DEFAULT_APPEARANCE }, false);
});

/** What the guard compares: the markup and the layout state the row leaves behind. */
function drawn() {
  const s = useSide.getState();
  const d = useRowDrag.getState();
  return {
    markup: container.innerHTML,
    narrow: s.narrow,
    open: s.layout.open,
    shelves: shelvesOf(s.layout).map((x) => `${x.id}:${x.side}:${x.collapsed ? "c" : "e"}:${x.width ?? "-"}`),
    rowDrag: { lead: d.lead, leadShare: d.leadShare, colW: d.colW },
  };
}

describe("landscape stays byte-identical with portrait inactive", () => {
  it.each(SCENARIOS.map((s) => [s.name, s] as const))("%s", (_name, sc) => {
    area = sc.area;
    appearance.setAppearance({ ...DEFAULT_APPEARANCE, ...sc.look }, false);
    useApp.setState({ selectedId: "eva", selectedHost: null, hosts: null, sidebar: { active: [session("eva", "Eva"), session("alden", "Alden")], retired: [], hostRows: {}, projects: null } as never });
    act(() => {
      usePanes.setState({ layout: sc.panes() });
      switchConversation("local|eva");
    });
    useSide.setState({ scope: "host:local", layout: sc.side(), mode: null, narrow: false, liveWidth: {} });
    act(() => root.render(h(SideWorkArea, { side: true, covered: !!sc.covered, split: sc.split ? { focused: 0 } : null, single: sc.split || sc.covered ? null : "main", children: h(Columns) })));
    // A resize pass at the same size (the observer's first notification).
    act(() => resize?.());
    expect(drawn()).toMatchSnapshot();
  });
});
