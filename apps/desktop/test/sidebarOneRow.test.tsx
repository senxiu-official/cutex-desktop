// @vitest-environment jsdom
// A project with no agent online is one row (design 060, owner 2026-11-05): hovering it opens nothing (the
// old flyout is gone); a click expands it in place as the full group with the same rule, and its header
// folds it back to one row. Quiet ones go into the automatic 「更早的项目」 folder.
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => {
  const api = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : () => Promise.resolve(null)) });
  return { api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m };
});

const paneKinds = { list: [] as { item: { id: string }; mode: string }[] };
vi.mock("../src/renderer/src/modules/react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOpenPage: () => null,
  usePageOf: () => null,
  useSlot: (slot: string) => (slot === "pane.kind" ? paneKinds.list : []),
}));

import type { SessionResource } from "@cutex-desktop/protocol";
import type { SidebarSnapshot } from "../src/shared/ipc";
import { getUiPrefs, setUiPref } from "../src/renderer/src/lib/prefs";
import { useApp } from "../src/renderer/src/store";
import { I18nProvider } from "../src/renderer/src/i18n";
import { services } from "../src/renderer/src/modules/app";
import { Sidebar } from "../src/renderer/src/components/Sidebar";
import { PROJECT_VIEW_KIND } from "../src/renderer/src/lib/sidebarProjectView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function session(id: string, name: string, minutesAgo: number): SessionResource {
  const at = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return { cutexSessionId: id, displayName: name, formalAgentName: name, registrationClass: null, lifecycle: "active", cwd: "/srv/q", note: null, avatar: null, createdAt: null, activity: { lastConversationAt: at }, native: { threadId: `t-${id}`, schema: null }, runtime: { status: "offline", activeTurnId: null } } as unknown as SessionResource;
}
const hostRow = (id: string) => ({ id, name: id, kind: "Agent", hostId: "x", profile: null, cwd: null, state: "offline", generation: 1, nativeId: null, projectId: "quiet", projectName: null });
const sessions = [session("q1", "quiet-alpha", 60), session("q2", "quiet-beta", 120), session("q3", "quiet-gamma", 180)];
const SIDEBAR = {
  active: sessions,
  retired: [],
  hostRows: Object.fromEntries(sessions.map((s) => [s.cutexSessionId, hostRow(s.cutexSessionId)])),
  projects: { projects: [{ project_id: "quiet", director_cutex_session_id: null, presentation: { display_name: "Quiet", badge_label: "Q", color: "cyan" } }] },
} as unknown as SidebarSnapshot;

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  paneKinds.list = [];
  setUiPref("noOnlineProjects", "collapse");
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
  vi.restoreAllMocks();
});

async function render(node: ReactNode) {
  await act(async () => root.render(h(I18nProvider, null, node)));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
}
const oneRow = () => container.querySelector<HTMLElement>('[data-one-row] button');
const names = () => [...container.querySelectorAll<HTMLElement>("[data-row-selectable]")].map((r) => r.textContent ?? "");

describe("a project with nobody online", () => {
  it("is one row; hover opens nothing; a click expands it in place; the header folds it back", async () => {
    await render(h(Sidebar));
    expect(oneRow()).not.toBeNull();
    expect(names()).toEqual([]);
    await act(async () => {
      oneRow()!.parentElement!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      oneRow()!.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await act(async () => oneRow()!.click());
    expect(oneRow()).toBeNull();
    const header = container.querySelector<HTMLElement>('[data-group-key] button[aria-expanded="true"]');
    expect(header).not.toBeNull();
    // The same rule as any project: these three were used today, so they are listed (offline, recently worked).
    expect(names().join("|")).toMatch(/alpha.*beta.*gamma/);
    await act(async () => header!.click());
    expect(oneRow()).not.toBeNull();
    expect(names()).toEqual([]);
  });
});

describe("「更早的项目」, the automatic folder", () => {
  const DAY = 24 * 60;
  const old = [session("o1", "old-alpha", 30 * DAY), session("o2", "old-beta", 31 * DAY)];
  const OLD = { ...SIDEBAR, active: old, hostRows: Object.fromEntries(old.map((s) => [s.cutexSessionId, hostRow(s.cutexSessionId)])) } as unknown as SidebarSnapshot;

  it("looks like a folder, opens by click, and stores nothing in sidebarSections, beside an owner folder of the same name", async () => {
    setUiPref("olderProjectsAfter", 7);
    setUiPref("restOpen", []);
    // The owner's own folder, also called 更早的项目, holding nothing.
    setUiPref("sidebarSections", [{ id: "s-mine", name: "更早的项目", collapsed: false, members: [] }]);
    useApp.setState({ sidebar: OLD });
    await render(h(Sidebar));
    const auto = container.querySelector<HTMLElement>("[data-older-projects] [data-folder-header]")!;
    expect(auto.textContent).toContain("Older projects");
    expect(auto.getAttribute("aria-expanded")).toBe("false");
    expect(oneRow()).toBeNull();
    await act(async () => auto.click());
    expect(getUiPrefs().restOpen).toEqual(["__older__"]);
    expect(container.querySelector("[data-older-projects] [data-one-row]")).not.toBeNull();
    // The owner's folder is untouched and a different element.
    expect(getUiPrefs().sidebarSections).toEqual([{ id: "s-mine", name: "更早的项目", collapsed: false, members: [] }]);
    expect(auto.closest("[data-sidebar-section]")).toBeNull();
    setUiPref("sidebarSections", []);
    setUiPref("restOpen", []);
  });

  it("expanded, a project with nobody online and nothing recent (no Director here) is just 「离线 +N」", async () => {
    setUiPref("olderProjectsAfter", "off");
    setUiPref("offlineFoldOpen", []);
    useApp.setState({ sidebar: OLD });
    await render(h(Sidebar));
    await act(async () => oneRow()!.click());
    expect(names()).toEqual([]);
    const fold = container.querySelector<HTMLButtonElement>("[data-agent-fold=offline] > button")!;
    expect(fold.textContent).toContain("+2");
    expect(container.querySelector("[data-agent-fold=idle]")).toBeNull();
    await act(async () => fold.click());
    expect(names().join("|")).toMatch(/alpha.*beta/);
    setUiPref("olderProjectsAfter", 7);
  });
});
