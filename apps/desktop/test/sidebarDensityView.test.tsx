// @vitest-environment jsdom
// Sidebar density, rendered (owner 2026-10-21): a big project lists its Director as a big row, the
// recently active agents as compact rows without the shared "demo-" prefix (full name in the tooltip),
// six of them before 「最近活跃 +N」 (expanded per group, remembered), and the group header's
// 「Project 视图」 button opens that project's pane through the pane service.
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
  return { cutexSessionId: id, displayName: name, formalAgentName: name, registrationClass: null, lifecycle: "active", cwd: "/srv/scp", note: null, avatar: null, createdAt: null, activity: { lastConversationAt: at }, native: { threadId: `t-${id}`, schema: null }, runtime: { status: "online", activeTurnId: null } } as unknown as SessionResource;
}
const hostRow = (id: string) => ({ id, name: id, kind: "Agent", hostId: "x", profile: null, cwd: null, state: "online", generation: 1, nativeId: null, projectId: "scp", projectName: null });
// The Director (idle an hour), ten agents active in the last 20 minutes, three idle for hours.
const sessions = [session("dir", "demo-director", 60), ...Array.from({ length: 10 }, (_, i) => session(`r${i}`, `demo-worker-${String(i).padStart(2, "0")}`, 1 + i)), ...Array.from({ length: 3 }, (_, i) => session(`i${i}`, `demo-shard-${i}`, 300 + i))];
const SIDEBAR = {
  active: sessions,
  retired: [],
  hostRows: Object.fromEntries(sessions.map((s) => [s.cutexSessionId, hostRow(s.cutexSessionId)])),
  projects: { projects: [{ project_id: "scp", director_cutex_session_id: "dir", presentation: { display_name: "DEMO", badge_label: "S", color: "magenta" } }] },
} as unknown as SidebarSnapshot;

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  paneKinds.list = [{ item: { id: PROJECT_VIEW_KIND }, mode: "show" }];
  setUiPref("recentOpen", []);
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
const rows = () => [...container.querySelectorAll<HTMLElement>("[data-row-selectable][role=button]")];
const fold = () => container.querySelector<HTMLButtonElement>("[data-recent-fold]");

describe("a big project in the sidebar", () => {
  it("the Director is the one big row; the recent agents are compact rows without the shared prefix, capped at 6", async () => {
    await render(h(Sidebar));
    const im = rows().filter((r) => r.hasAttribute("data-row-im"));
    expect(im).toHaveLength(1);
    expect(im[0]!.textContent).toContain("director");
    expect(im[0]!.textContent).not.toContain("demo-director");
    const compact = rows().filter((r) => r.hasAttribute("data-row-compact"));
    expect(compact).toHaveLength(6);
    // Newest first, the shown name without "demo-", the full name in the tooltip.
    expect(compact[0]!.textContent).toContain("worker-00");
    expect(compact[0]!.textContent).not.toContain("demo-");
    expect(compact[0]!.getAttribute("title")).toContain("demo-worker-00");
    expect(fold()!.getAttribute("aria-expanded")).toBe("false");
    expect(fold()!.textContent).toContain("+4");
  });

  it("「最近活跃 +N」 expands (remembered per group) and collapses again", async () => {
    await render(h(Sidebar));
    await act(async () => fold()!.click());
    expect(getUiPrefs().recentOpen).toEqual(["scp"]);
    expect(rows().filter((r) => r.hasAttribute("data-row-compact"))).toHaveLength(10);
    expect(fold()!.getAttribute("aria-expanded")).toBe("true");
    await act(async () => fold()!.click());
    expect(getUiPrefs().recentOpen).toEqual([]);
    expect(rows().filter((r) => r.hasAttribute("data-row-compact"))).toHaveLength(6);
  });

  it("the header's Project 视图 button opens the project's pane", async () => {
    const open = vi.spyOn(services.panes, "open").mockReturnValue({ status: "opened", kind: PROJECT_VIEW_KIND, paneId: null, instanceId: "x" });
    await render(h(Sidebar));
    const button = container.querySelector<HTMLButtonElement>("[data-open-project-view]")!;
    expect(button).toBeTruthy();
    await act(async () => button.click());
    expect(open).toHaveBeenCalledWith(PROJECT_VIEW_KIND, { hostId: "local", projectId: "scp" }, { focus: true });
  });

  it("no button while no module contributes the pane kind", async () => {
    paneKinds.list = [];
    await render(h(Sidebar));
    expect(container.querySelector("[data-open-project-view]")).toBeNull();
  });
});
