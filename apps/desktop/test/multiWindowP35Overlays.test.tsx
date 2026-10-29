// @vitest-environment jsdom
// Multi-window P3.5 (docs/desktop-modules.md §24.17): what a drag or a change in a desk window shows is drawn in that
// desk, not in the main window — the width tip (its edge's document), the Shelf toast (the window the change happened
// in; its undo acts there), the Ctrl/⌘ + click column pick (that window's own columns), the drop morph's instance
// boxes (the pane's document). The desk is an iframe's document, as in deskShell.test.tsx.
import { act, createElement as h, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ bridge: {}, api: {}, apiFor: () => ({}), cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/store", async () => {
  const { create } = await import("zustand");
  const { selectionAware } = await import("../src/renderer/src/lib/windowScope");
  const useApp = selectionAware(create(() => ({ selectedId: "main-agent" as string | null, selectedHost: "local" as string | null, view: { kind: "conversation" }, hosts: { active: "local" } })));
  return { useApp, hostApi: () => ({}), agentHost: (s: { selectedHost: string | null }) => s.selectedHost ?? "local", sidebarOf: () => null };
});
vi.mock("../src/renderer/src/lib/workspaceView", async () => {
  const { createContext } = await import("react");
  return { WorkspaceContext: createContext(null), useSelectedScope: () => null, useSelectedHost: () => "local", useWorkspace: () => ({}) };
});
vi.mock("../src/renderer/src/modules/react", () => ({ useOpenPage: () => null }));
vi.mock("../src/renderer/src/modules/Outlet", () => ({ PageAsideOutlet: () => null }));
vi.mock("../src/renderer/src/components/PaneHost", () => ({ PaneHost: () => null }));
vi.mock("../src/renderer/src/components/ChipTray", () => ({ DesktopBackground: () => null, TrayFrame: ({ children }: { children: ReactNode }) => children }));
vi.mock("../src/renderer/src/components/side/SideInstanceLayer", () => ({ SideInstanceLayer: () => null }));
vi.mock("../src/renderer/src/components/SettingsShelf", () => ({ SettingsShelf: () => null }));
vi.mock("../src/renderer/src/components/WindowControls", () => ({ LinuxControls: () => null, CaptionSpace: () => null }));
const replaced = vi.hoisted(() => [] as { window: string; paneId: string }[]);
vi.mock("../src/renderer/src/lib/workspaces", async () => {
  const { currentWindow } = await import("../src/renderer/src/lib/windowScope");
  return { replaceWith: (_h: string, _k: string, paneId: string) => replaced.push({ window: currentWindow(), paneId }) };
});

import { DeskWindows } from "../src/renderer/src/components/DeskWindows";
import { ColumnPickLayer } from "../src/renderer/src/components/ColumnPickLayer";
import { ShelfToast } from "../src/renderer/src/components/side/ShelfToast";
import { WidthTip } from "../src/renderer/src/components/WidthTip";
import { finishColumnPick, startColumnPick, useColumnPick } from "../src/renderer/src/lib/columnPick";
import { useDesks } from "../src/renderer/src/lib/deskStore";
import { endMorph, morphTo } from "../src/renderer/src/lib/dropMorph";
import { defaultLayout } from "../src/renderer/src/lib/paneLayout";
import { usePanes } from "../src/renderer/src/lib/paneStore";
import { dismissShelfToast, showShelfToast, undoShelfToast, useShelfToast } from "../src/renderer/src/lib/shelves";
import { hideWidthTip, showWidthTip, useWidthTip } from "../src/renderer/src/lib/widthTip";
import { currentWindow, inWindow, MAIN_WINDOW, resetWindowsForTest } from "../src/renderer/src/lib/windowScope";
import { I18nProvider } from "../src/renderer/src/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DESK = "d000000000001";
let frame: HTMLIFrameElement;
let host: HTMLElement;
let app: ReturnType<typeof createRoot>;
let deskDoc: Document;

beforeEach(() => {
  frame = document.createElement("iframe");
  document.body.append(frame);
  deskDoc = frame.contentDocument!;
  const root = deskDoc.createElement("div");
  deskDoc.body.append(root);
  usePanes.of(MAIN_WINDOW).setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "main-agent" }) });
  usePanes.of(DESK).setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "desk-agent" }) });
  useDesks.setState({ desks: [{ deskId: DESK, handle: { deskId: DESK, win: frame.contentWindow!, root, dispose: () => {} }, content: { kind: "conversation", hostId: "local", sessionId: "desk-agent" } }] });
  host = document.createElement("div");
  document.body.append(host);
  app = createRoot(host);
  // The main window's global layers (App) and the desks (DeskWindows), as App mounts them.
  act(() => app.render(h(I18nProvider, null, h(DeskWindows), h(WidthTip), h(ColumnPickLayer), h(ShelfToast))));
});

afterEach(() => {
  act(() => app.unmount());
  host.remove();
  useDesks.setState({ desks: [], focused: null });
  useShelfToast.setState({ toast: null });
  useColumnPick.setState({ pick: null });
  useWidthTip.setState({ tip: null });
  replaced.length = 0;
  resetWindowsForTest();
  frame.remove();
});

describe("overlays in the window they belong to (multi-window P3.5)", () => {
  it("the width tip of a desk's edge shows in the desk; a main window edge's in the main window", () => {
    const edge = deskDoc.createElement("div");
    deskDoc.body.append(edge);
    act(() => showWidthTip(edge, 420));
    expect(deskDoc.querySelector("[data-width-tip]")?.textContent).toMatch(/420/);
    expect(document.querySelector("[data-width-tip]")).toBeNull();
    const mainEdge = document.createElement("div");
    document.body.append(mainEdge);
    act(() => showWidthTip(mainEdge, 300));
    expect(document.querySelector("[data-width-tip]")?.textContent).toMatch(/300/);
    expect(deskDoc.querySelector("[data-width-tip]")).toBeNull();
    act(() => hideWidthTip());
    mainEdge.remove();
  });

  it("a Shelf toast shows in the window the change happened in; its undo runs there", () => {
    const ran: string[] = [];
    act(() => inWindow(DESK, () => showShelfToast("closed in the desk", () => ran.push(currentWindow()))));
    expect(deskDoc.querySelector("[data-shelf-toast]")?.textContent).toMatch(/closed in the desk/);
    expect(document.querySelector("[data-shelf-toast]")).toBeNull();
    // 撤销 pressed (whatever window is active then): the undo acts on the desk's Shelves.
    act(() => undoShelfToast());
    expect(ran).toEqual([DESK]);
    expect(deskDoc.querySelector("[data-shelf-toast]")).toBeNull();
    act(() => showShelfToast("in the main window"));
    expect(document.querySelector("[data-shelf-toast]")?.textContent).toMatch(/in the main window/);
    expect(deskDoc.querySelector("[data-shelf-toast]")).toBeNull();
    act(() => dismissShelfToast());
  });

  it("a column pick started in a desk offers that desk's columns, drawn there; the pick replaces there", () => {
    const deskPane = usePanes.of(DESK).getState().layout.focus!;
    // The desk's column, as PaneHost draws it, so the layer finds its box.
    const col = deskDoc.createElement("section");
    col.setAttribute("data-conv-pane", deskPane);
    col.getBoundingClientRect = () => ({ left: 10, top: 10, width: 300, height: 400, right: 310, bottom: 410, x: 10, y: 10, toJSON: () => ({}) }) as DOMRect;
    deskDoc.body.append(col);
    act(() => inWindow(DESK, () => startColumnPick({ hostId: "local", key: "other" })));
    expect(useColumnPick.getState().pick?.win).toBe(DESK);
    expect(deskDoc.querySelector("[data-column-pick-shield]")).not.toBeNull();
    expect(deskDoc.querySelector(`[data-column-pick="${deskPane}"]`)).not.toBeNull();
    expect(document.querySelector("[data-column-pick-shield]")).toBeNull();
    act(() => finishColumnPick(deskPane));
    expect(replaced).toEqual([{ window: DESK, paneId: deskPane }]);
    expect(deskDoc.querySelector("[data-column-pick-shield]")).toBeNull();
  });

  it("a drop morph moves a desk pane's instance boxes from the desk's document", () => {
    const card = deskDoc.createElement("div");
    const inst = deskDoc.createElement("div");
    inst.setAttribute("data-side-card-of", "c1");
    deskDoc.body.append(card, inst);
    // Same id in the main window: not the desk pane's instance.
    const decoy = document.createElement("div");
    decoy.setAttribute("data-side-card-of", "c1");
    document.body.append(decoy);
    morphTo([{ el: card, to: { left: 40, top: 0, width: 100, height: 100 }, card: { id: "c1", peer: null } }]);
    expect(inst.style.transform).toBe("translate(40px, 0px)");
    expect(decoy.style.transform).toBe("");
    endMorph(true);
    decoy.remove();
  });
});
