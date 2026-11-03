// @vitest-environment jsdom
// Portrait (owner update 2026-10-30, lib/portrait): the sidebar is hidden by default in a portrait window — out of the flow,
// only the hint line and hot zone — and Ctrl/⌘+B (toggleSidebarRail) shows it as an OVERLAY held over the stack, a portrait
// pref of its own: the landscape setting is untouched and rotating back docks the sidebar as before. Harness:
// test/sidebarPeek.test.tsx.
import { act, createElement as h, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => {
  const api = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : () => Promise.resolve(null)) });
  return { api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m };
});
vi.mock("../src/renderer/src/modules/react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOpenPage: () => null,
  usePageOf: () => null,
  useSlot: () => [],
}));

import type { SessionResource } from "@cutex-desktop/protocol";
import type { SidebarSnapshot } from "../src/shared/ipc";
import { getUiPrefs, setUiPref, toggleSidebarRail } from "../src/renderer/src/lib/prefs";
import { useApp } from "../src/renderer/src/store";
import { I18nProvider } from "../src/renderer/src/i18n";
import { Sidebar } from "../src/renderer/src/components/Sidebar";
import { useSidebarEdge, useSidebarPeek } from "../src/renderer/src/lib/windowSidebar";
import { MAIN_WINDOW } from "../src/renderer/src/lib/windowScope";
import { noteWindowBox, resetPortraitForTest, usePortrait } from "../src/renderer/src/lib/portrait";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function session(id: string, name: string): SessionResource {
  return { cutexSessionId: id, displayName: name, formalAgentName: name, registrationClass: null, lifecycle: "active", cwd: `/tmp/${id}`, note: null, avatar: null, native: { threadId: `t-${id}`, schema: null }, runtime: { status: "online", activeTurnId: null } } as unknown as SessionResource;
}
const SIDEBAR = {
  active: [session("lead", "Lead"), session("solo", "Solo")],
  retired: [],
  hostRows: {
    lead: { id: "lead", name: "lead", kind: "Agent", hostId: "x", profile: null, cwd: null, state: "online", generation: 1, nativeId: null, projectId: "p1", projectName: null },
    solo: { id: "solo", name: "solo", kind: "Agent", hostId: "x", profile: null, cwd: null, state: "online", generation: 1, nativeId: null, projectId: null, projectName: null },
  },
  projects: { projects: [{ project_id: "p1", director_cutex_session_id: "lead", presentation: { display_name: "P1", badge_label: "P", color: "#3b82f6" } }] },
} as unknown as SidebarSnapshot;

let root: Root;
let container: HTMLElement;
const q = (sel: string) => container.querySelector<HTMLElement>(sel);
const open = () => q('[data-sidebar-mode="open"]');
const pop = () => q("[data-sidebar-pop]");
const zone = () => q("[data-sidebar-peek-zone]");
const edge = () => useSidebarEdge.of(MAIN_WINDOW).getState().shown;
const out = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("pointerout", { bubbles: true })));
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  resetPortraitForTest();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  setUiPref("sidebarRail", false);
  useSidebarPeek.of(MAIN_WINDOW).setState({ popped: false });
  useApp.setState({
    hosts: { active: "local", scope: { kind: "host", id: "local" }, hosts: [{ id: "local", kind: "local", label: "This PC", conn: { epoch: 1, daemon: { kind: "connected" } } }] } as never,
    daemon: { kind: "connected" } as never,
    selectedId: null,
    sidebar: SIDEBAR,
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  setUiPref("sidebarRail", false);
  useSidebarPeek.of(MAIN_WINDOW).setState({ popped: false });
  resetPortraitForTest();
});

async function render(node: ReactNode) {
  await act(async () => root.render(h(I18nProvider, null, node)));
  await act(async () => void vi.advanceTimersByTimeAsync(0));
}

describe("portrait: the sidebar is hidden, then shown over the stack", () => {
  it("hidden by default; the toggle holds the overlay (no retract), the landscape setting stays; landscape docks it again", async () => {
    await render(h(Sidebar));
    expect(open()).toBeTruthy();
    await act(async () => void noteWindowBox(MAIN_WINDOW, { width: 1080, height: 1920 }));
    expect(open()).toBeNull();
    expect(zone()).toBeTruthy();
    expect(pop()).toBeNull();
    await act(async () => toggleSidebarRail());
    expect(usePortrait.of(MAIN_WINDOW).getState().prefs.sidebarShown).toBe(true);
    expect(getUiPrefs().sidebarRail).toBe(false);
    const card = pop()!;
    expect(card.hasAttribute("data-sidebar-held")).toBe(true);
    expect(card.className).toContain("absolute");
    // Held: no 「固定」 (the sidebar never docks in portrait), only ×.
    expect(q("[data-sidebar-peek-pin]")).toBeNull();
    expect(edge()).toBe(false);
    // Held: the pointer leaving does not retract it; its × hides it (the portrait pref again).
    out(card);
    tick(1000);
    expect(pop()).toBeTruthy();
    await act(async () => q("[data-sidebar-peek-close]")!.click());
    expect(pop()).toBeNull();
    expect(usePortrait.of(MAIN_WINDOW).getState().prefs.sidebarShown).toBe(false);
    // Rotating back: docked, as the landscape setting says.
    await act(async () => void noteWindowBox(MAIN_WINDOW, { width: 1920, height: 1080 }));
    expect(open()).toBeTruthy();
    expect(getUiPrefs().sidebarRail).toBe(false);
  });

  it("a hidden landscape sidebar stays hidden after a portrait round trip with the overlay shown", async () => {
    setUiPref("sidebarRail", true);
    await render(h(Sidebar));
    expect(open()).toBeNull();
    await act(async () => void noteWindowBox(MAIN_WINDOW, { width: 1080, height: 1920 }));
    await act(async () => toggleSidebarRail());
    expect(pop()).toBeTruthy();
    await act(async () => void noteWindowBox(MAIN_WINDOW, { width: 1920, height: 1080 }));
    expect(getUiPrefs().sidebarRail).toBe(true);
    expect(open()).toBeNull();
    expect(pop()).toBeNull();
  });
});

describe("portrait P2: the held overlay and the keyboard", () => {
  const input = () => q("[data-probe-input]") as HTMLTextAreaElement;
  const esc = () => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  const shown = () => usePortrait.of(MAIN_WINDOW).getState().prefs.sidebarShown;
  const withMain = () => h(Fragment, null, h(Sidebar), h("div", { "data-focus-region": "main" }, h("section", { "data-pane-focused": "" }, h("textarea", { "data-probe-input": "" }))));

  it("an Esc from inside the held overlay hides it, the focus going to the conversation's input; an Esc elsewhere is the conversation's", async () => {
    await render(withMain());
    await act(async () => void noteWindowBox(MAIN_WINDOW, { width: 1080, height: 1920 }));
    await act(async () => toggleSidebarRail());
    expect(pop()).toBeTruthy();
    // Esc in the composer: the overlay stays (the conversation's Esc chain is not the sidebar's).
    act(() => input().focus());
    esc();
    expect(shown()).toBe(true);
    expect(pop()).toBeTruthy();
    // Esc with the focus in the overlay: hidden, and the focus is not left on the document's body.
    act(() => q("[data-sidebar-peek-close]")!.focus());
    esc();
    expect(shown()).toBe(false);
    expect(pop()).toBeNull();
    expect(document.activeElement).toBe(input());
  });

  it("Ctrl/⌘+B with the focus in the held overlay hides it and hands the focus back too; the landscape peek is as it was", async () => {
    await render(withMain());
    await act(async () => void noteWindowBox(MAIN_WINDOW, { width: 1080, height: 1920 }));
    await act(async () => toggleSidebarRail());
    act(() => q("[data-sidebar-peek-close]")!.focus());
    await act(async () => toggleSidebarRail());
    expect(pop()).toBeNull();
    expect(document.activeElement).toBe(input());
    // Landscape, hidden sidebar: the popped peek retracting does not move the focus (unchanged behaviour).
    setUiPref("sidebarRail", true);
    await act(async () => void noteWindowBox(MAIN_WINDOW, { width: 1920, height: 1080 }));
    act(() => useSidebarPeek.of(MAIN_WINDOW).setState({ popped: true }));
    act(() => q("[data-sidebar-peek-close]")!.focus());
    esc();
    expect(pop()).toBeNull();
    expect(document.activeElement).not.toBe(input());
  });
});
