// @vitest-environment jsdom
// The folded sidebar (owner 2026-10-28): collapsed is fully hidden — nothing in the layout, only a 3 px hint
// line and a 4 px hot zone at the window's left edge; resting there for 250 ms pops the whole sidebar OVER
// the content (absolute, no width edge), 300 ms after the pointer leaves it retracts, Esc and opening an
// agent retract at once, and 「固定」 pins it expanded (the same pref as Ctrl/⌘+B). Pure timing:
// test/sidebarPeek.test.ts.
import { act, createElement as h, type ReactNode } from "react";
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
import { getUiPrefs, setUiPref } from "../src/renderer/src/lib/prefs";
import { useApp } from "../src/renderer/src/store";
import { I18nProvider } from "../src/renderer/src/i18n";
import { Sidebar } from "../src/renderer/src/components/Sidebar";
import { useSidebarEdge, useSidebarPeek } from "../src/renderer/src/lib/windowSidebar";
import { MAIN_WINDOW } from "../src/renderer/src/lib/windowScope";

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
const over = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
const out = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("pointerout", { bubbles: true })));
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
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
});

async function render(node: ReactNode) {
  await act(async () => root.render(h(I18nProvider, null, node)));
  await act(async () => void vi.advanceTimersByTimeAsync(0));
}

describe("the folded sidebar is hidden until it pops over the content", () => {
  it("expanded: the sidebar card is in the layout and publishes its width edge; hidden: nothing in the layout, only the hint line and the hot zone", async () => {
    await render(h(Sidebar));
    expect(open()).toBeTruthy();
    expect(zone()).toBeNull();
    expect(edge()).toBe(true);
    await act(async () => setUiPref("sidebarRail", true));
    expect(open()).toBeNull();
    expect(q("[data-sidebar-peek-line]")).toBeTruthy();
    expect(zone()).toBeTruthy();
    expect(edge()).toBe(false);
    act(() => root.unmount());
    expect(edge()).toBe(false);
    root = createRoot(container);
  });

  it("resting on the left edge for 250 ms pops the sidebar over the content (not in the flow, no width edge)", async () => {
    setUiPref("sidebarRail", true);
    await render(h(Sidebar));
    over(zone()!);
    tick(249);
    expect(pop()).toBeNull();
    tick(1);
    const card = pop()!;
    expect(card.getAttribute("data-sidebar-mode")).toBe("pop");
    // Over the content: absolute (not a layout pane) and the hint line is gone while it is shown.
    expect(card.className).toContain("absolute");
    expect(card.hasAttribute("data-resizable-pane")).toBe(false);
    expect(q("[data-sidebar-peek-line]")).toBeNull();
    expect(edge()).toBe(false);
  });

  it("the pointer leaving retracts it 300 ms later; coming back in holds it", async () => {
    setUiPref("sidebarRail", true);
    await render(h(Sidebar));
    over(zone()!);
    tick(250);
    const card = pop()!;
    out(card);
    tick(299);
    expect(pop()).toBeTruthy();
    over(card);
    tick(5);
    expect(pop()).toBeTruthy();
    out(card);
    tick(299);
    expect(pop()).toBeTruthy();
    tick(1);
    expect(pop()).toBeNull();
    // Hidden again: the hint line is back.
    expect(q("[data-sidebar-peek-line]")).toBeTruthy();
  });

  it("Esc retracts at once", async () => {
    setUiPref("sidebarRail", true);
    await render(h(Sidebar));
    over(zone()!);
    tick(250);
    expect(pop()).toBeTruthy();
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(pop()).toBeNull();
  });

  it("opening an agent from the popped sidebar retracts it; 「固定」 pins the sidebar expanded", async () => {
    setUiPref("sidebarRail", true);
    await render(h(Sidebar));
    over(zone()!);
    tick(250);
    const row = pop()!.querySelector<HTMLElement>("[data-row-selectable]")!;
    await act(async () => row.click());
    expect(pop()).toBeNull();
    expect(useApp.getState().selectedId).toBeTruthy();
    over(zone()!);
    tick(250);
    await act(async () => pop()!.querySelector<HTMLButtonElement>("[data-sidebar-peek-pin]")!.click());
    expect(getUiPrefs().sidebarRail).toBe(false);
    expect(open()).toBeTruthy();
    expect(zone()).toBeNull();
  });
});
