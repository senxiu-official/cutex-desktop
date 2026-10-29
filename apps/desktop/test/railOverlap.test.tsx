// @vitest-environment jsdom
// Owner report 2026-10-24: Settings in its Shelf, a conversation, the conversation's Shelf collapsed to its Rail. With
// the Settings Shelf wide, expanding the Rail drew the conversation's Shelf as the narrow-window drawer right over the
// conversation (and it felt stuck). Now the work row says what it needs (the conversation and its expanded Shelf at their
// minimums, lib/settingsShelf useSettingsRowNeed) and the Settings card gives that room down to its own minimum: the
// Shelf opens in the row. Only a row too small even then gets the drawer — the card then keeps its width, and the
// drawer is clearly on top (the conversation beside it dimmed; a click there closes it).
import { act, createElement as h } from "react";
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
import { applyOpen, emptyLayout, MIN_CONVERSATION, MIN_SIDE, place, placeSpec, setOpen, shelvesOf, SINGLETON_KEY, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { defaultLayout } from "../src/renderer/src/lib/paneLayout";
import { usePanes } from "../src/renderer/src/lib/paneStore";
import { useSide } from "../src/renderer/src/lib/sideLayoutStore";
import { useApp } from "../src/renderer/src/store";
import * as appearance from "../src/renderer/src/lib/appearance";
import { DEFAULT_APPEARANCE } from "../src/renderer/src/lib/appearanceModel";
import { sideFrame } from "../src/renderer/src/lib/sideFrame";
import { FOLD_HYSTERESIS } from "../src/renderer/src/lib/foldHysteresis";
import { SETTINGS_SHELF_MIN_W, SETTINGS_SHELF_ROW_KEEP, settingsRowKeep, settingsShelfWidth, setSettingsRowNeed, useSettingsRowNeed } from "../src/renderer/src/lib/settingsShelf";

const { SideWorkArea } = await import("../src/renderer/src/components/side/SideArea");

/** One workspace with its Shelf expanded needs this beside the Settings card (no left Shelf). */
const NEED = MIN_CONVERSATION + MIN_SIDE + FOLD_HYSTERESIS;

/** The work area left beside the Settings card in a row of `row` px with the card stored at `stored`, for the row's `need`. */
const areaBeside = (row: number, stored: number, need: number) => row - settingsShelfWidth(stored, row, settingsRowKeep(need, row));
const frameIn = (area: number, wasNarrow: boolean) =>
  sideFrame({ areaWidth: area, stored: 420, open: true, pages: 0, laneWhenHidden: "hide", pageBar: "tabs", mode: "push", layered: null, mins: { conversation: MIN_CONVERSATION, side: MIN_SIDE }, wasNarrow });

describe("the Settings card gives the work row what its expanded Shelf needs (pure)", () => {
  it("keeps a conversation's width by default; more only while the row needs it and the card can give it", () => {
    expect(settingsShelfWidth(1200, 1612)).toBe(1612 - SETTINGS_SHELF_ROW_KEEP);
    expect(settingsShelfWidth(1200, 1612, settingsRowKeep(NEED, 1612))).toBe(1612 - NEED);
    expect(settingsRowKeep(0, 1612)).toBe(SETTINGS_SHELF_ROW_KEEP);
    // A row too small for the need even at the card's minimum: the card does not shrink for a drawer that comes anyway.
    expect(settingsRowKeep(NEED, SETTINGS_SHELF_MIN_W + NEED - 1)).toBe(SETTINGS_SHELF_ROW_KEEP);
    expect(settingsRowKeep(NEED, SETTINGS_SHELF_MIN_W + NEED)).toBe(NEED);
    // Never under the card's minimum, never wider than the owner's width.
    expect(settingsShelfWidth(700, 1900, settingsRowKeep(NEED, 1900))).toBe(700);
    expect(settingsShelfWidth(2000, 1400, settingsRowKeep(NEED, 1400))).toBe(Math.max(SETTINGS_SHELF_MIN_W, 1400 - NEED));
  });

  it("sweep rows 900–4000 px × card widths: wherever the card can give the room, the expanded Shelf is in the row (never the drawer); else the card keeps its width", () => {
    let flows = 0;
    let drawers = 0;
    for (let row = 900; row <= 4000; row += 17)
      for (const stored of [640, 760, 1000, 1400, 2200, 3600]) {
        const before = areaBeside(row, stored, 0);
        const area = areaBeside(row, stored, NEED);
        // Even right after a drawer frame (the fold's slack holds a drawer), the area beside the card fits the Shelf.
        if (row - SETTINGS_SHELF_MIN_W >= NEED) {
          expect(area, `row ${row} stored ${stored}`).toBeGreaterThanOrEqual(NEED);
          expect(frameIn(area, true).kind).toBe("flow");
          expect(area).toBeGreaterThanOrEqual(before); // the card only ever gives
          flows++;
        } else {
          expect(area).toBe(before);
          if (frameIn(area, false).kind === "drawer") drawers++;
        }
      }
    expect(flows).toBeGreaterThan(100);
    expect(drawers).toBeGreaterThan(10);
  });
});

// ── The work row: what it says it needs, the drawer on top ──

let clock = 100;
const host: SideBinding = { kind: "host", hostId: "local" };
function withBrowser(l: SideLayout = emptyLayout()): SideLayout {
  const input = { kind: "browser.tab" as ItemId, binding: host, key: SINGLETON_KEY, state: { url: "https://example.com" } as never, v: 1, pinned: false };
  const decision = place(l, { ...input, transient: false, activePage: l.activePage, columnOpen: l.open }, placeSpec({ home: "browser" }));
  return applyOpen(l, decision, input, ++clock, { reveal: true, home: "browser" }).layout;
}
const session = (id: string, name: string) => ({ cutexSessionId: id, displayName: name, avatar: null, native: { threadId: null }, runtime: { status: "online" }, cwd: "" }) as unknown as SessionResource;

let root: Root;
let container: HTMLElement;
let area = 1600;
const observers: (() => void)[] = [];
const q = (sel: string) => container.querySelector<HTMLElement>(sel);
const render = () => act(() => root.render(h(SideWorkArea, { side: true, split: null, single: "main", children: h("i") })));
/** The window resized / the Settings card changed width: the work area is `px` now. */
const setArea = (px: number) => {
  area = px;
  act(() => observers.forEach((cb) => cb()));
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  area = 1600;
  observers.length = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        observers.push(cb);
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
  setSettingsRowNeed(0);
  useApp.setState({ selectedId: "eva", selectedHost: null, hosts: null, sidebar: { active: [session("eva", "Eva")], retired: [], hostRows: {}, projects: null } as never });
  useSide.setState({ scope: "host:local", layout: setOpen(withBrowser(), false), mode: null, narrow: false, liveWidth: {} });
  appearance.setAppearance({ ...DEFAULT_APPEARANCE }, false);
  usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  appearance.setAppearance({ ...DEFAULT_APPEARANCE }, false);
  setSettingsRowNeed(0);
});

describe("expanding the Rail beside a wide Settings Shelf", () => {
  /** Expands the conversation's Shelf from its rail (a page on the rail = open it to that page). */
  const expand = () => act(() => q('[data-shelf-box="right"] [data-shelf-rail-collapsed] [data-shelf-page]')!.click());

  it("the card gives the room: the Shelf opens in the row beside the conversation, not over it", () => {
    // A 1612 px row, the Settings card stored at 1200: the work area beside it is what the card leaves.
    const row = 1612;
    setArea(areaBeside(row, 1200, useSettingsRowNeed.getState().need));
    render();
    expect(area).toBe(SETTINGS_SHELF_ROW_KEEP);
    expect(useSettingsRowNeed.getState().need).toBe(0); // only the rail: a conversation's width is enough
    expand();
    expect(shelvesOf(useSide.getState().layout)[0]!.collapsed).toBeFalsy();
    // The row now says what it needs; the card (SettingsShelf) gives it and the work area grows.
    expect(useSettingsRowNeed.getState().need).toBe(NEED);
    setArea(areaBeside(row, 1200, useSettingsRowNeed.getState().need));
    expect(q("[data-side-box]")!.getAttribute("data-side-frame")).toBe("flow");
    expect(q("[data-drawer-scrim]")).toBeNull();
    // Folding the Shelf again: the row needs nothing more, the card takes its width back.
    act(() => useSide.setState({ layout: setOpen(useSide.getState().layout, false) }));
    expect(useSettingsRowNeed.getState().need).toBe(0);
  });

  it("truly no room (the card at its minimum would still not leave enough): the drawer, clearly on top — the conversation dimmed, a click there closes it", () => {
    const row = 1212; // 1500 px window, 256 px sidebar
    setArea(areaBeside(row, 760, 0));
    render();
    expand();
    setArea(areaBeside(row, 760, useSettingsRowNeed.getState().need));
    expect(area).toBe(row - 760); // the card did not shrink for nothing
    expect(q("[data-side-box]")!.getAttribute("data-side-frame")).toBe("drawer");
    const scrim = q("[data-conv-card] [data-drawer-scrim]")!;
    expect(scrim).not.toBeNull();
    act(() => void scrim.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(q("[data-drawer-scrim]")).toBeNull();
    expect(q("[data-side-box]")).toBeNull();
  });
});
