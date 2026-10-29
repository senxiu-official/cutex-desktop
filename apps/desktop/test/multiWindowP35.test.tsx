// @vitest-environment jsdom
// Multi-window P3.5 (docs/desktop-modules.md §24.17): the tray's open list (lib/trayOpen) and its remembered
// workspaces (lib/workspaceSets) are per window — stored per desk, one copy per agent across windows, a closed desk's
// tray handed to the main window's; a remembered-but-not-reopened desk's too.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

import { DeskContext } from "../src/renderer/src/lib/deskContext";
import { bindPane, defaultLayout, openBeside, type PaneLayout } from "../src/renderer/src/lib/paneLayout";
import { usePanes } from "../src/renderer/src/lib/paneStore";
import { handOpenToMain, mergeOpen, OPEN_STORAGE_KEY, openStorageKey, startTrayOpen, useTrayOpen } from "../src/renderer/src/lib/trayOpen";
import { inWindow, MAIN_WINDOW, resetWindowsForTest, useActiveWindow } from "../src/renderer/src/lib/windowScope";
import { handSetsToMain, mergeSets, SETS_STORAGE_KEY, setsStorageKey, startWorkspaceSets, useWorkspaceSets } from "../src/renderer/src/lib/workspaceSets";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const D = "d000000000001";
const E = "d000000000002";
const one = (sessionId: string): PaneLayout => defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId });
const two = (a: string, b: string): PaneLayout => openBeside(one(a), { hostId: "local", sessionId: b }, 1)!;
const ids = (list: readonly { sessionId: string }[]) => list.map((o) => o.sessionId);
const memberIds = (key: string) => useWorkspaceSets.of(key).getState().sets.map((s) => s.members.map((m) => m.sessionId).join("+"));

let stops: (() => void)[] = [];
beforeEach(() => {
  localStorage.clear();
  for (const key of [MAIN_WINDOW]) {
    useTrayOpen.of(key).setState({ open: [], back: [] });
    useWorkspaceSets.of(key).setState({ sets: [], pinned: new Set() });
    usePanes.of(key).setState({ layout: one("m0"), scope: null });
  }
});
afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
  resetWindowsForTest();
});

describe("per-window tray (lib/trayOpen, lib/workspaceSets)", () => {
  it("each window stores its own list under its own key; the main window keeps the old key", () => {
    expect(openStorageKey(MAIN_WINDOW)).toBe(OPEN_STORAGE_KEY);
    expect(openStorageKey(D)).toBe(`${OPEN_STORAGE_KEY}.desk:${D}`);
    expect(setsStorageKey(MAIN_WINDOW)).toBe(SETS_STORAGE_KEY);
    expect(setsStorageKey(D)).toBe(`${SETS_STORAGE_KEY}.desk:${D}`);
    // A desk's stored list is read when its store is made (a desk reopening after a restart).
    localStorage.setItem(openStorageKey(E), JSON.stringify({ v: 1, open: [{ hostId: "local", sessionId: "e1", at: 5 }] }));
    localStorage.setItem(setsStorageKey(E), JSON.stringify({ v: 1, sets: [{ id: "w1", members: [{ hostId: "local", sessionId: "e1" }], at: 5 }] }));
    expect(ids(useTrayOpen.of(E).getState().open)).toEqual(["e1"]);
    expect(memberIds(E)).toEqual(["e1"]);
    expect(useTrayOpen.of(MAIN_WINDOW).getState().open).toEqual([]);
    // A desk with nothing stored starts empty (the old-open-list seeding is the main window's first run only).
    localStorage.setItem(OPEN_STORAGE_KEY, JSON.stringify({ v: 1, open: [{ hostId: "local", sessionId: "old", at: 1 }] }));
    expect(useWorkspaceSets.of(D).getState().sets).toEqual([]);
  });

  it("a replace in a desk lands in the desk's tray only; the main window's tray is untouched", () => {
    stops.push(startTrayOpen(), startWorkspaceSets());
    usePanes.of(D).setState({ layout: one("d1") });
    // The desk replaces d1 by d2 (a sidebar click there): d1 is open, not on screen — in the desk's tray.
    const l = usePanes.of(D).getState().layout;
    usePanes.of(D).setState({ layout: bindPane(l, l.focus!, "local", "d2") });
    expect(ids(useTrayOpen.of(D).getState().open)).toEqual(["d1"]);
    expect(useTrayOpen.of(MAIN_WINDOW).getState().open).toEqual([]);
    expect(memberIds(D)).toEqual(["d2", "d1"]);
    expect(memberIds(MAIN_WINDOW).join()).not.toMatch(/d1|d2/);
    // Stored under the desk's key, not the main window's.
    expect(JSON.parse(localStorage.getItem(openStorageKey(D))!).open.map((o: { sessionId: string }) => o.sessionId)).toEqual(["d1"]);
    expect(localStorage.getItem(OPEN_STORAGE_KEY) ?? "").not.toContain("d1");
    // The hook reads the window the component is drawn in.
    const seen: string[][] = [];
    function Probe() {
      seen.push(useTrayOpen((s) => s.open).map((o) => o.sessionId));
      return null;
    }
    const el = document.createElement("div");
    const root = createRoot(el);
    act(() => root.render(h("div", null, h(Probe), h(DeskContext.Provider, { value: D }, h(Probe)))));
    expect(seen).toEqual([[], ["d1"]]);
    act(() => root.unmount());
  });

  it("one copy: an agent that goes on screen in another window leaves this window's open list and sets", () => {
    stops.push(startTrayOpen(), startWorkspaceSets());
    usePanes.of(D).setState({ layout: one("d1") });
    const l = usePanes.of(D).getState().layout;
    usePanes.of(D).setState({ layout: bindPane(l, l.focus!, "local", "d2") });
    expect(ids(useTrayOpen.of(D).getState().open)).toEqual(["d1"]);
    // The main window opens d1 (beside its m0): the desk's chip of it goes (Director 2026-10-27: fine for now).
    usePanes.of(MAIN_WINDOW).setState({ layout: two("m0", "d1") });
    expect(useTrayOpen.of(D).getState().open).toEqual([]);
    expect(memberIds(D)).toEqual(["d2"]);
    expect(memberIds(MAIN_WINDOW)[0]).toBe("m0+d1");
  });

  it("a closed desk's tray joins the main window's (merged, one entry per agent) and its stored tray goes", () => {
    stops.push(startTrayOpen(), startWorkspaceSets());
    inWindow(MAIN_WINDOW, () => useTrayOpen.setState({ open: [{ hostId: "local", sessionId: "m9", at: 10 }] }));
    usePanes.of(D).setState({ layout: one("d1") });
    const l = usePanes.of(D).getState().layout;
    usePanes.of(D).setState({ layout: bindPane(l, l.focus!, "local", "d2") });
    expect(localStorage.getItem(openStorageKey(D))).not.toBeNull();
    handOpenToMain(D);
    handSetsToMain(D);
    expect(ids(useTrayOpen.of(MAIN_WINDOW).getState().open).sort()).toEqual(["d1", "m9"]);
    expect(memberIds(MAIN_WINDOW)).toEqual(expect.arrayContaining(["d2", "d1"]));
    expect(useTrayOpen.of(D).getState().open).toEqual([]);
    expect(localStorage.getItem(openStorageKey(D))).toBeNull();
    expect(localStorage.getItem(setsStorageKey(D))).toBeNull();
  });

  it("a remembered desk that does not come back: its stored tray is read and handed to the main window", () => {
    localStorage.setItem(openStorageKey(E), JSON.stringify({ v: 1, open: [{ hostId: "local", sessionId: "e1", at: 5 }] }));
    localStorage.setItem(setsStorageKey(E), JSON.stringify({ v: 1, sets: [{ id: "we", members: [{ hostId: "local", sessionId: "e1" }], at: 5 }] }));
    handOpenToMain(E);
    handSetsToMain(E);
    expect(ids(useTrayOpen.of(MAIN_WINDOW).getState().open)).toEqual(["e1"]);
    expect(memberIds(MAIN_WINDOW)).toContain("e1");
    expect(useTrayOpen.windows()).not.toContain(E);
    expect(localStorage.getItem(openStorageKey(E))).toBeNull();
  });

  it("merges keep newest first and one entry per agent", () => {
    const a = (sessionId: string, at: number) => ({ hostId: "local", sessionId, at });
    expect(ids(mergeOpen([a("x", 1), a("y", 5)], [a("x", 9), a("z", 3)]))).toEqual(["x", "y", "z"]);
    const set = (id: string, at: number, ...m: string[]) => ({ id, at, members: m.map((sessionId) => ({ hostId: "local", sessionId })) });
    expect(mergeSets([set("a", 1, "x", "y")], [set("b", 2, "y")]).map((s) => `${s.id}:${s.members.map((m) => m.sessionId).join("+")}`)).toEqual(["b:y", "a:x"]);
  });

  it("「返回上一个」 steps are the window's own", async () => {
    const { pushBack, popBack } = await import("../src/renderer/src/lib/trayOpen");
    inWindow(D, () => pushBack({ kind: "strip", hostId: "local", sessionId: "d1" }));
    expect(useTrayOpen.of(MAIN_WINDOW).getState().back).toEqual([]);
    expect(popBack()).toBeNull();
    useActiveWindow.setState({ key: D });
    expect(popBack()).toMatchObject({ sessionId: "d1" });
  });
});
