// @vitest-environment jsdom
// Standalone rows (owner 2026-11-06): the independent group (and quick chats) sit on the folder level with the
// folder's left edge, icon box and name type, but none of a folder's own marks (colour, count beside the
// name, thick line), and never inside the folder above them. Real children stay indented.
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
const sessions = [session("q1", "quiet-alpha", 60), session("i1", "solo-one", 90)];
const SIDEBAR = {
  active: sessions,
  retired: [],
  hostRows: Object.fromEntries(sessions.map((s) => [s.cutexSessionId, s.cutexSessionId === "i1" ? { ...hostRow("i1"), projectId: null } : hostRow(s.cutexSessionId)])),
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

const KEY = JSON.stringify(["local", "quiet"]);

describe("the independent group next to a folder", () => {
  it("is a standalone row at the folder's level, outside the open folder above it, without a folder's marks", async () => {
    setUiPref("sidebarSections", [{ id: "s-life", name: "生活", collapsed: false, members: [KEY] }]);
    await render(h(Sidebar));
    const folder = container.querySelector<HTMLElement>("[data-sidebar-section] [data-folder-header]")!;
    // Nobody online: the one-row form, still a standalone row.
    const solo = container.querySelector<HTMLElement>('[data-group-key*="__independent__"] [data-standalone-header]')!;
    expect(solo).not.toBeNull();
    expect(solo.closest("[data-sidebar-section]")).toBeNull();
    // The folder's left edge and name type; no line, no count beside the name, neutral colour.
    for (const cls of ["-ml-1", "pl-0.5"]) {
      expect(folder.className).toContain(cls);
      expect(solo.className).toContain(cls);
    }
    const name = solo.querySelector<HTMLElement>("[data-standalone-name]")!;
    expect(name.className).toContain("text-ui");
    expect(name.className).toContain("font-semibold");
    expect(name.className).not.toContain("folder-ink");
    expect(solo.querySelector(".folder-line, .folder-ink")).toBeNull();
    // The folder's own project is its child: indented under it.
    const child = container.querySelector<HTMLElement>("[data-sidebar-section] [data-group-key]")!;
    expect(child.closest("[data-roster-body]")!.className).toContain("pl-2");
    setUiPref("sidebarSections", []);
  });

  it("opened, it stays a standalone header and lists its agents under it", async () => {
    setUiPref("noOnlineProjects", "expand");
    await render(h(Sidebar));
    const header = container.querySelector<HTMLElement>('[data-group-key*="__independent__"] [data-standalone-header]')!;
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(names().some((n) => n.includes("solo-one"))).toBe(true);
    await act(async () => header.click());
    expect(container.querySelector('[data-group-key*="__independent__"] [data-standalone-header]')!.getAttribute("aria-expanded")).toBe("false");
    setUiPref("noOnlineProjects", "collapse");
  });
});

describe("system rows and the roster spacing table (owner 2026-11-06)", () => {
  it("a system row is grey with a system line (虚线 by default, 灰底条 by the setting); a folder keeps its coloured line", async () => {
    setUiPref("sidebarSections", [{ id: "s-life", name: "生活", collapsed: false, members: [KEY] }]);
    await render(h(Sidebar));
    const roster = container.querySelector<HTMLElement>("[data-sidebar-roster]")!;
    expect(getUiPrefs().systemRows).toBe("line");
    expect(roster.dataset.systemRows).toBe("line");
    const solo = container.querySelector<HTMLElement>("[data-group-key*=\"__independent__\"] [data-standalone-header]")!;
    expect(solo.hasAttribute("data-system-row")).toBe(true);
    expect(solo.querySelector(".system-line")).not.toBeNull();
    const folder = container.querySelector<HTMLElement>("[data-sidebar-section] [data-folder-header]")!;
    expect(folder.hasAttribute("data-system-row")).toBe(false);
    expect(folder.querySelector(".folder-line")).not.toBeNull();
    await act(async () => setUiPref("systemRows", "band"));
    expect(container.querySelector<HTMLElement>("[data-sidebar-roster]")!.dataset.systemRows).toBe("band");
    setUiPref("systemRows", "line");
    setUiPref("sidebarSections", []);
  });

  it("every block says what it is and carries no margin of its own (the gaps are the styles.css table)", async () => {
    setUiPref("sidebarSections", [{ id: "s-life", name: "生活", collapsed: false, members: [KEY] }]);
    await render(h(Sidebar));
    const kinds = [...container.querySelectorAll<HTMLElement>("[data-sidebar-roster] > [data-roster-kind]")].map((e) => e.dataset.rosterKind);
    expect(kinds).toEqual(["folder", "system"]);
    expect(container.querySelector("[data-sidebar-section] > [data-roster-body] > [data-roster-kind=project]")).not.toBeNull();
    for (const el of container.querySelectorAll<HTMLElement>("[data-roster-kind], [data-roster-body]")) expect(el.className.split(" ").filter((c) => /^-?m[tby]-|^not-first:m/.test(c))).toEqual([]);
    setUiPref("sidebarSections", []);
  });
});
