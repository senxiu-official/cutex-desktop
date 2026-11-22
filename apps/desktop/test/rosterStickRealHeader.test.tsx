// @vitest-environment jsdom
// The 花名册's stuck headers are the real headers (owner 2026-11-18): nothing is drawn a second time for an edge, so a
// header stuck at the top (CSS sticky: the [data-stick] row itself) or sitting in the bottom stack (the same row moved
// by RosterStick) has its own icon and colour, its own right-click menu, folds with a click / Enter in place, takes a
// project drop and keeps focus — exactly as in place. The one difference, by design: a click on a header sitting in
// the bottom stack brings its group up instead of folding it (GLOSSARY 吸附标题).
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
import { closeMenu, useOverlayState } from "../src/renderer/src/lib/contextMenu";
import { useApp } from "../src/renderer/src/store";
import { I18nProvider } from "../src/renderer/src/i18n";
import { Sidebar } from "../src/renderer/src/components/Sidebar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function session(id: string, name: string, project: string): SessionResource {
  const at = new Date(Date.now() - 5 * 60_000).toISOString();
  return { cutexSessionId: id, displayName: name, formalAgentName: name, registrationClass: null, lifecycle: "active", cwd: `/srv/${project}`, note: null, avatar: null, createdAt: null, activity: { lastConversationAt: at }, native: { threadId: `t-${id}`, schema: null }, runtime: { status: "online", activeTurnId: null } } as unknown as SessionResource;
}
const AGENTS: [string, string, string | null][] = [
  ["a1", "Abel", "loose"],
  ["b1", "Bree", "filed"],
  ["i1", "Ivo", null],
];
const SIDEBAR = {
  active: AGENTS.map(([id, name, project]) => session(id, name, project ?? "none")),
  retired: [],
  hostRows: Object.fromEntries(AGENTS.map(([id, name, project]) => [id, { id, name, kind: "Agent", hostId: "local", profile: null, cwd: null, state: "online", generation: 1, nativeId: null, projectId: project, projectName: null }])),
  projects: {
    projects: [
      { project_id: "loose", director_cutex_session_id: null, presentation: { display_name: "Loose", badge_label: "L", color: "cyan" } },
      { project_id: "filed", director_cutex_session_id: null, presentation: { display_name: "Filed", badge_label: "F", color: "blue" } },
    ],
  },
} as unknown as SidebarSnapshot;
const FILED = JSON.stringify(["local", "filed"]);
const LOOSE = JSON.stringify(["local", "loose"]);
const DEV = { id: "s-dev", name: "开发 Development", collapsed: false, look: { icon: "flag", color: "#F76B15" }, members: [FILED] };

let menu: { items: unknown[] } | null = null;
function MenuProbe(): ReactNode {
  menu = useOverlayState().menu;
  return null;
}

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  setUiPref("sidebarLayout", "roster");
  setUiPref("foldedProjects", []);
  setUiPref("sidebarSections", [DEV]);
  useApp.setState({
    hosts: { active: "local", scope: { kind: "host", id: "local" }, hosts: [{ id: "local", kind: "local", label: "This PC", conn: { epoch: 1, daemon: { kind: "connected" } } }] } as never,
    daemon: { kind: "connected" } as never,
    selectedId: null,
    sidebar: SIDEBAR,
  });
});
afterEach(() => {
  act(() => closeMenu());
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  setUiPref("sidebarSections", []);
  setUiPref("foldedProjects", []);
});

async function render() {
  await act(async () => root.render(h(I18nProvider, null, h(Sidebar), h(MenuProbe))));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
}
const folder = () => container.querySelector<HTMLElement>('section[data-stick-group="folder:s-dev"]')!;
/** The row that sticks (CSS sticky at the top; moved by RosterStick at the bottom). */
const stickRow = (section: HTMLElement) => section.querySelector<HTMLElement>(":scope > [data-stick]")!;
const toggle = (section: HTMLElement) => stickRow(section).querySelector<HTMLElement>("button[aria-expanded]")!;
const labels = () => (menu?.items ?? []).filter((i): i is { label: string } => typeof i === "object" && i !== null && "label" in i).map((i) => i.label);

/** Make RosterStick see `section`'s header in the bottom stack (its header drawn above its group's place). */
function stuckAtBottom(section: HTMLElement) {
  const header = stickRow(section);
  const rect = (top: number) => ({ top, bottom: top + 28, left: 0, right: 200, width: 200, height: 28, x: 0, y: top, toJSON() {} }) as DOMRect;
  vi.spyOn(section, "getBoundingClientRect").mockReturnValue(rect(900));
  vi.spyOn(header, "getBoundingClientRect").mockReturnValue(rect(500));
}

async function rightClick(el: HTMLElement) {
  await act(async () => el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })));
}

describe("a stuck header is the real header", () => {
  it("one element per header, the one that sticks; no copy anywhere (the old title dock is gone)", async () => {
    await render();
    expect(container.querySelector("[data-title-dock]")).toBeNull();
    const named = [...container.querySelectorAll("[data-folder-name]")].filter((e) => e.textContent?.includes("开发 Development"));
    expect(named).toHaveLength(1);
    expect(stickRow(folder()).contains(named[0]!)).toBe(true);
    expect(stickRow(folder()).dataset.stick).toBe("edge");
  });

  it("keeps the folder's own icon and colour, at the top and in the bottom stack", async () => {
    await render();
    const icon = () => stickRow(folder()).querySelector("svg.lucide-flag");
    expect(icon()).not.toBeNull();
    expect(stickRow(folder()).querySelector("svg.lucide-folder")).toBeNull();
    expect(folder().style.getPropertyValue("--folder-color").toUpperCase()).toBe("#F76B15");
    stuckAtBottom(folder());
    expect(icon()).not.toBeNull();
    expect(stickRow(folder()).querySelector("svg.lucide-folder")).toBeNull();
  });

  it("right-click: the folder's own menu, stuck at the top (the sticky row) and in the bottom stack alike", async () => {
    await render();
    await rightClick(toggle(folder()));
    const inPlace = labels();
    expect(inPlace.length).toBeGreaterThan(2);
    act(() => closeMenu());
    stuckAtBottom(folder());
    await rightClick(toggle(folder()));
    expect(labels()).toEqual(inPlace);
  });

  it("click and Enter fold it in place; focus stays on its own toggle", async () => {
    await render();
    const btn = toggle(folder());
    btn.focus();
    expect(document.activeElement).toBe(btn);
    await act(async () => btn.click());
    expect(folder().hasAttribute("data-folded")).toBe(true);
    expect(document.activeElement).toBe(toggle(folder()));
    await act(async () => toggle(folder()).click());
    expect(folder().hasAttribute("data-folded")).toBe(false);
  });

  it("in the bottom stack a click brings its group up (opening it if folded) instead of folding it, and focuses the same toggle", async () => {
    setUiPref("sidebarSections", [{ ...DEV, collapsed: true }]);
    await render();
    expect(folder().hasAttribute("data-folded")).toBe(true);
    stuckAtBottom(folder());
    const nav = container.querySelector<HTMLElement>('nav[data-sidebar-roster="roster"]')!;
    nav.scrollTo = vi.fn() as unknown as typeof nav.scrollTo;
    const btn = toggle(folder());
    await act(async () => btn.click());
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(folder().hasAttribute("data-folded")).toBe(false);
    expect(nav.scrollTo).toHaveBeenCalled();
    expect(document.activeElement).toBe(toggle(folder()));
  });

  it("takes a project drop on the same row, as in place", async () => {
    await render();
    const project = container.querySelector<HTMLElement>(`[data-group-key='${LOOSE}'] [draggable="true"]`) ?? container.querySelector<HTMLElement>(`[data-group-key='${LOOSE}'] [draggable]`);
    expect(project).not.toBeNull();
    const ev = (type: string) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, "dataTransfer", { value: { effectAllowed: "", dropEffect: "", setData() {}, getData: () => "" } });
      return e;
    };
    await act(async () => project!.dispatchEvent(ev("dragstart")));
    const row = stickRow(folder());
    const over = ev("dragover");
    await act(async () => row.dispatchEvent(over));
    expect(over.defaultPrevented).toBe(true);
    expect(row.hasAttribute("data-section-drop-over")).toBe(true);
    await act(async () => row.dispatchEvent(ev("drop")));
    expect(getUiPrefs().sidebarSections.find((s) => s.id === "s-dev")!.members).toContain(LOOSE);
  });
});
