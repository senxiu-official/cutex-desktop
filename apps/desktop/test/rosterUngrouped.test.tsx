// @vitest-environment jsdom
// 「未分组」 (owner 2026-11-18): while there are 文件夹, the 花名册's projects in no folder sit under an automatic
// 系统行 directly above 独立智能体 — the real FolderHeader in its system look (count, fold kept in prefs), a sticky
// group like every other (top edge, bottom stack). Not without folders, not when every project is filed, not in 现在·全部.
import { act, createElement as h } from "react";
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

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  setUiPref("sidebarLayout", "roster");
  setUiPref("foldedProjects", []);
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
  setUiPref("sidebarSections", []);
  setUiPref("sidebarLayout", "roster");
  setUiPref("foldedProjects", []);
});

async function render() {
  await act(async () => root.render(h(I18nProvider, null, h(Sidebar))));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
}
const ungrouped = () => container.querySelector<HTMLElement>("section[data-ungrouped]");
const topGroups = () => [...container.querySelectorAll<HTMLElement>('nav[data-sidebar-roster="roster"] > section[data-stick-group]')].map((s) => s.dataset.stickGroup);

describe("「未分组」", () => {
  it("with a folder: the projects in no folder are under 未分组, a system row right above 独立智能体, a sticky header", async () => {
    setUiPref("sidebarSections", [{ id: "s-work", name: "工作区", collapsed: false, members: [FILED] }]);
    await render();
    const section = ungrouped()!;
    expect(section).not.toBeNull();
    const order = topGroups();
    expect(order.indexOf("ungrouped")).toBeGreaterThan(order.indexOf("folder:s-work"));
    expect(order[order.indexOf("ungrouped") + 1]).toMatch(/^independent:/);
    expect(section.hasAttribute("data-stick-system")).toBe(true);
    expect(section.querySelector("[data-folder-header]")!.hasAttribute("data-system-row")).toBe(true);
    // The loose project is inside it; the filed one is in its folder.
    expect(section.querySelector(`[data-group-key='${LOOSE}']`)).not.toBeNull();
    expect(section.querySelector(`[data-group-key='${FILED}']`)).toBeNull();
    // The real folder header: count, the sticky edge, the same click (fold).
    const header = section.querySelector<HTMLElement>(":scope > [data-stick='edge'] [data-folder-header]")!;
    expect(header.textContent).toContain("1");
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(section.dataset.stickLabel).toBeTruthy();
  });

  it("folds like a folder, and the fold is kept (prefs)", async () => {
    setUiPref("sidebarSections", [{ id: "s-work", name: "工作区", collapsed: false, members: [FILED] }]);
    await render();
    await act(async () => ungrouped()!.querySelector<HTMLElement>("[data-folder-header]")!.click());
    expect(ungrouped()!.hasAttribute("data-folded")).toBe(true);
    expect(ungrouped()!.querySelector(`[data-group-key='${LOOSE}']`)).toBeNull();
    expect(getUiPrefs().foldedProjects).toContain("__ungrouped__");
    // Folder order and the folders themselves are untouched.
    expect(getUiPrefs().sidebarSections.map((s) => s.id)).toEqual(["s-work"]);
  });

  it("no folders: no 未分组 (every project is ungrouped; the list is as before)", async () => {
    await render();
    expect(ungrouped()).toBeNull();
    expect(container.querySelector(`[data-group-key='${LOOSE}']`)).not.toBeNull();
  });

  it("every project in a folder: no 未分组", async () => {
    setUiPref("sidebarSections", [{ id: "s-work", name: "工作区", collapsed: false, members: [FILED, LOOSE] }]);
    await render();
    expect(ungrouped()).toBeNull();
  });

  it("现在·全部: unchanged, no 未分组", async () => {
    setUiPref("sidebarSections", [{ id: "s-work", name: "工作区", collapsed: false, members: [FILED] }]);
    setUiPref("sidebarLayout", "now-all");
    await render();
    expect(ungrouped()).toBeNull();
  });
});
