// @vitest-environment jsdom
// 最大化 with real widths (owner 2026-10-23, docs/design/003 「真宽度」; lib/panelGrow + lib/panelGrowStart) on the real
// stores. The owner's repro (3820 px window, sidebar | conversation | right Shelf at the window's edge, the seam
// dragged: the Shelf's far edge moved in ~50 px) was 最大化 ending on the drag's press — the Shelf went back to its
// stored width from the far side. Now: an edge drag, something new in a Shelf, a window resize keep it; 还原 writes the
// widths before back (even after drags); the row's set of panes changing drops the restore point and keeps the
// layout. (The geometry itself — every other edge still within 0.5 px — is checked in the browser fuzz, .claude.)
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

import { getAppearance, setAppearance } from "../src/renderer/src/lib/appearance";
import { resizeDrag } from "../src/renderer/src/lib/columnGlide";
import { addConversationColumn, defaultLayout } from "../src/renderer/src/lib/paneLayout";
import { usePanes } from "../src/renderer/src/lib/paneStore";
import { endGrow, markGrowBaked, resetGrow, setGrowRoom, toggleGrow, useGrow } from "../src/renderer/src/lib/panelGrow";
import { startPanelGrow } from "../src/renderer/src/lib/panelGrowStart";
import { setColumnWidth, useRowDrag } from "../src/renderer/src/lib/rowDrag";
import { applyOpen, emptyLayout, place, placeSpec, setShelfWidth, shelvesOf, SINGLETON_KEY, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import type { SideBinding } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import { useSide } from "../src/renderer/src/lib/sideLayoutStore";

const FOLLOW: SideBinding = { kind: "follow", hostId: "local" };
let clock = 100;
function open(layout: SideLayout, kind: string): SideLayout {
  const input = { kind: kind as ItemId, binding: FOLLOW, key: SINGLETON_KEY, state: null, v: 1, pinned: false };
  const decision = place(layout, { ...input, transient: false, activePage: layout.activePage, columnOpen: layout.open }, placeSpec({ home: "workspace" }));
  return applyOpen(layout, decision, input, ++clock, { reveal: true, home: "workspace" }).layout;
}

const one = () => defaultLayout({ sidebarOpen: true, sidebarWidth: 240, hostId: "local", sessionId: "A" });
const shelfWidth = () => shelvesOf(useSide.getState().layout)[0]!.width ?? null;

startPanelGrow();

beforeEach(() => {
  resetGrow();
  usePanes.setState({ layout: one() });
  useSide.setState({ layout: open(emptyLayout(), "workspace.files") });
  useRowDrag.setState({ lead: null, leadShare: null, colW: [null, null] });
  setAppearance({ singleColumnW: 0 });
  setGrowRoom({ conv: { main: 400 }, shelf: 400 });
});

/** What the row does in the render that draws 最大化 (components/side/SideArea): the grown widths stored. */
function bake(store: () => void) {
  store();
  markGrowBaked();
}

describe("最大化 stores real widths and keeps a restore point", () => {
  it("the owner's seam drag: the drag's press does not end it, so nothing goes back to the stored width", () => {
    const id = shelvesOf(useSide.getState().layout)[0]!.id;
    useSide.setState({ layout: setShelfWidth(useSide.getState().layout, id, 460) });
    toggleGrow({ kind: "shelf", conv: null, shelfId: id, card: null });
    // The Shelf took the free row up to the window's edge.
    bake(() => useSide.setState({ layout: setShelfWidth(useSide.getState().layout, id, 510) }));
    resizeDrag(true);
    expect(useGrow.getState().target).not.toBeNull();
    expect(shelfWidth()).toBe(510);
    // The drag moved the seam: a real width now.
    useSide.setState({ layout: setShelfWidth(useSide.getState().layout, id, 630) });
    resizeDrag(false);
    expect(useGrow.getState().target).not.toBeNull();
    expect(shelfWidth()).toBe(630);
    // 还原: the width before 最大化, not the dragged one.
    endGrow();
    expect(shelfWidth()).toBe(460);
  });

  it("a maximised conversation: 还原 puts the single column's width back after a drag", () => {
    setAppearance({ singleColumnW: 770 });
    toggleGrow({ kind: "conv", paneId: "main" });
    bake(() => setAppearance({ singleColumnW: 3060 }));
    resizeDrag(true);
    setAppearance({ singleColumnW: 2940 });
    resizeDrag(false);
    expect(useGrow.getState().target).toEqual({ kind: "conv", paneId: "main" });
    endGrow();
    expect(getAppearance().singleColumnW).toBe(770);
  });

  it("two workspaces: the columns' widths and share come back", () => {
    usePanes.setState({ layout: addConversationColumn(one(), { hostId: "local", sessionId: "B" }, 1) });
    setColumnWidth(0, 600);
    const cols = usePanes.getState().layout.cols.map((c) => c.w);
    setGrowRoom({ conv: { main: 400 }, shelf: 0 });
    toggleGrow({ kind: "conv", paneId: "main" });
    bake(() => {
      setColumnWidth(0, 1000);
      usePanes.setState({ layout: { ...usePanes.getState().layout, cols: usePanes.getState().layout.cols.map((c, i) => ({ ...c, w: i === 0 ? 0.7 : 0.3 })) } });
    });
    endGrow();
    expect(useRowDrag.getState().colW[0]).toBe(600);
    expect(usePanes.getState().layout.cols.map((c) => c.w)).toEqual(cols);
  });

  it("something new inside the Shelf keeps it; the row's set of panes changing drops it and keeps the layout", () => {
    const id = shelvesOf(useSide.getState().layout)[0]!.id;
    toggleGrow({ kind: "shelf", conv: null, shelfId: id, card: null });
    bake(() => useSide.setState({ layout: setShelfWidth(useSide.getState().layout, id, 900) }));
    useSide.setState({ layout: open(useSide.getState().layout, "workspace.changes") });
    expect(useGrow.getState().target).not.toBeNull();
    // A second conversation pane: the row is another one now.
    usePanes.setState({ layout: addConversationColumn(one(), { hostId: "local", sessionId: "B" }, 1) });
    expect(useGrow.getState().target).toBeNull();
    expect(shelfWidth()).toBe(900);
  });
});
