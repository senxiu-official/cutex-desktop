// @vitest-environment jsdom
// The sidebar's session search (harness C3, cutex r295 session-search-v1): hosts without the capability keep today's
// name / preview search (no 工作目录, no 查找旧任务); a capable host gets both. 查找旧任务 searches the capable hosts only,
// results are plain text with host context, the directory filter narrows that host's rows (and the text still applies),
// and 已归档 is offered on owner connections only.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridgeCalls: string[] = [];
vi.mock("../src/renderer/src/bridge", () => {
  const api = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : () => (bridgeCalls.push(String(m)), Promise.resolve(null))) });
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
import type { SessionSearchQuery, SessionSearchResponse } from "../src/shared/sessionSearch";
import { setUiPref } from "../src/renderer/src/lib/prefs";
import { useApp } from "../src/renderer/src/store";
import { I18nProvider } from "../src/renderer/src/i18n";
import { Sidebar } from "../src/renderer/src/components/Sidebar";
import { noteHostAccess } from "../src/renderer/src/lib/hostAccess";
import { resetIdLookupLists } from "../src/renderer/src/lib/delegationIdSearch";
import { clearTaskSearch, resetSearchLanes, setArchivedSearch, setDirFilter, setSearchHosts, setSessionSearchApi } from "../src/renderer/src/lib/sessionSearchStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function session(id: string, name: string, project: string, cwd: string): SessionResource {
  const at = new Date(Date.now() - 5 * 60_000).toISOString();
  return { cutexSessionId: id, displayName: name, formalAgentName: name, registrationClass: null, lifecycle: "active", cwd, note: null, avatar: null, createdAt: null, activity: { lastConversationAt: at }, native: { threadId: `t-${id}`, schema: null }, runtime: { status: "online", activeTurnId: null } } as unknown as SessionResource;
}
function snapshot(host: string, agents: [string, string, string][], project: string, name: string): SidebarSnapshot {
  const active = agents.map(([id, n, cwd]) => session(id, n, project, cwd));
  return {
    active,
    retired: [],
    hostRows: Object.fromEntries(agents.map(([id, n]) => [id, { id, name: n, kind: "Agent", hostId: host, profile: null, cwd: null, state: "online", generation: 1, nativeId: null, projectId: project, projectName: null }])),
    projects: { projects: [{ project_id: project, director_cutex_session_id: null, presentation: { display_name: name, badge_label: name[0], color: "cyan" } }] },
  } as unknown as SidebarSnapshot;
}
const LOCAL = snapshot("local", [["l1", "Lumen", "D:\\Work\\app"], ["l2", "Lark", "D:\\Work\\app\\sub"], ["l3", "Moss", "D:\\Other"]], "home", "Home");
const ALPHA = snapshot("alpha", [["a1", "Zeta", "/srv/far"]], "far", "Far");

let root: Root;
let container: HTMLElement;
const calls: { hostId: string; query: SessionSearchQuery }[] = [];
let reply: (hostId: string, query: SessionSearchQuery) => SessionSearchResponse;

function setup({ localSearch = true, alphaSearch = false, scope = "all" as "all" | "local" } = {}) {
  const feat = (on: boolean) => new Set(on ? ["session-search-v1"] : []);
  useApp.setState({
    hosts: {
      active: "local",
      scope: scope === "all" ? { kind: "all" } : { kind: "host", id: "local" },
      hosts: [
        { id: "local", kind: "local", label: "This PC", conn: { epoch: "e-local", daemon: { kind: "connected" } } },
        { id: "alpha", kind: "dev-direct", label: "alpha", conn: { epoch: "e-alpha", daemon: { kind: "connected" } } },
      ],
    } as never,
    daemon: { kind: "connected" } as never,
    selectedId: null,
    features: feat(localSearch),
    sidebar: LOCAL,
    byHost: { alpha: { epoch: "e-alpha", daemon: { kind: "connected" }, features: feat(alphaSearch), featuresKnown: true, sidebar: ALPHA, approvals: null, services: null, waiting: {} } } as never,
  });
}
const names = () => [...container.querySelectorAll<HTMLElement>("[data-row-selectable]")].map((r) => r.textContent ?? "");
const has = (name: string) => names().some((n) => n.includes(name));
const $ = (sel: string) => container.querySelector<HTMLElement>(sel);
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
async function render() {
  await act(async () => root.render(h(I18nProvider, null, h(Sidebar))));
  await settle();
}
async function type(sel: string, value: string) {
  const el = $(sel) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(sel: string) {
  await act(async () => $(sel)!.click());
  await settle();
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  setUiPref("noOnlineProjects", "expand");
  setUiPref("sidebarLayout", "roster");
  calls.length = 0;
  reply = () => ({ contractVersion: 2, hostId: "x", mode: "tasks", items: [], nextCursor: null, more: false, partial: false });
  setSessionSearchApi((hostId) => ({ async sessionSearch(query) { calls.push({ hostId, query }); return reply(hostId, query); } }));
  resetSearchLanes();
  resetIdLookupLists();
  bridgeCalls.length = 0;
  setSearchHosts(null);
  setArchivedSearch(false);
  clearTaskSearch();
  void setDirFilter(null);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setSessionSearchApi(null);
  setUiPref("noOnlineProjects", "collapse");
});

describe("sidebar session search", () => {
  it("without the capability the search stays name / preview only", async () => {
    setup({ localSearch: false, alphaSearch: false });
    await render();
    expect($("[data-sidebar-dir-toggle]")).toBeNull();
    await type("[data-sidebar-search]", "Lum");
    expect(has("Lumen")).toBe(true);
    expect(has("Zeta")).toBe(false);
    expect($("[data-old-tasks]")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("查找旧任务 searches the capable hosts only; results are plain text with host context", async () => {
    setup({ localSearch: true, alphaSearch: false });
    reply = (hostId, query) => ({
      contractVersion: 2, hostId: "HOST-A", mode: "tasks", nextCursor: null, more: false, partial: true,
      items: [{ hostId: "HOST-A", cutexSessionId: "l1", displayName: "Lumen", cwd: "D:\\Work\\app", lifecycle: "active", updatedAt: "", turnId: "t7", title: `<img src=x onerror="boom()"> ${query.q}`, snippet: "", turnStatus: "interrupted" }],
    });
    await render();
    await type("[data-sidebar-search]", "flush");
    expect($("[data-old-tasks-start]")?.textContent).toContain("flush");
    // Owner connection: 已归档 is offered.
    expect($("[data-old-tasks-archived]")).not.toBeNull();
    await click("[data-old-tasks-start]");
    expect(calls).toEqual([{ hostId: "local", query: { mode: "tasks", q: "flush" } }]);
    const row = $("[data-old-task]")!;
    expect(row.querySelector("img")).toBeNull();
    expect(row.querySelector("[data-old-task-title]")!.textContent).toBe('<img src=x onerror="boom()"> flush');
    expect(row.querySelector("mark")?.textContent).toBe("flush");
    expect(row.textContent).toContain("Lumen");
    expect(row.textContent).toContain("This PC");
    expect($("[data-old-tasks-partial]")).not.toBeNull();
    // No cursor left and results: no 继续查找, no empty line.
    expect($("[data-old-tasks-more]")).toBeNull();
    expect($("[data-old-tasks-none]")).toBeNull();
  });

  it("已归档 sends lifecycle=retired to owner connections only", async () => {
    setup({ localSearch: true, alphaSearch: true });
    noteHostAccess("alpha", { user: { id: "u-guest", kind: "user", displayName: "Guest" } });
    await render();
    await type("[data-sidebar-search]", "old");
    await click("[data-old-tasks-archived]");
    await click("[data-old-tasks-start]");
    expect(calls).toEqual([{ hostId: "local", query: { mode: "tasks", q: "old", lifecycle: "retired" } }]);
    noteHostAccess("alpha", null);
  });

  it("the 工作目录 filter narrows that host's rows, the text still applies, and old tasks search there", async () => {
    setup({ localSearch: true, alphaSearch: false });
    reply = (_hostId, query) => (query.mode === "sessions"
      ? { contractVersion: 2, hostId: "HOST-A", mode: "sessions", nextCursor: null, more: false, partial: false, items: ["l1", "l2"].map((id) => ({ hostId: "HOST-A", cutexSessionId: id, displayName: id, cwd: "D:\\Work\\app", lifecycle: "active", updatedAt: "" })) }
      : { contractVersion: 2, hostId: "HOST-A", mode: "tasks", nextCursor: null, more: false, partial: false, items: [] });
    await render();
    expect(has("Moss") && has("Zeta")).toBe(true);
    await click("[data-sidebar-dir-toggle]");
    // Several hosts in scope, one capable: the filter names its host.
    expect($("[data-sidebar-dir-host]")?.textContent).toBe("This PC");
    await type("[data-sidebar-dir-path]", "D:\\Work\\app");
    await act(async () => $("[data-sidebar-dir-path]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await settle();
    expect(calls).toEqual([{ hostId: "local", query: { mode: "sessions", cwd: "D:\\Work\\app" } }]);
    expect(has("Lumen") && has("Lark")).toBe(true);
    expect(has("Moss")).toBe(false);
    // Another host's rows are not under this host's path.
    expect(has("Zeta")).toBe(false);
    await type("[data-sidebar-search]", "Lark");
    expect(has("Lark")).toBe(true);
    expect(has("Lumen")).toBe(false);
    await click("[data-old-tasks-start]");
    expect(calls.at(-1)).toEqual({ hostId: "local", query: { mode: "tasks", q: "Lark", cwd: "D:\\Work\\app" } });
    // The empty completion: no host has a cursor left.
    expect($("[data-old-tasks-none]")).not.toBeNull();
    // Clearing the filter brings every row back.
    await type("[data-sidebar-search]", "");
    await click('[data-sidebar-dir-filter] button[aria-label]');
    expect(has("Moss") && has("Zeta")).toBe(true);
  });

  it("results are dropped when the scope or a connection changes", async () => {
    setup({ localSearch: true });
    reply = () => ({ contractVersion: 2, hostId: "HOST-A", mode: "tasks", nextCursor: "more", more: true, partial: false, items: [{ hostId: "HOST-A", cutexSessionId: "l1", displayName: "Lumen", cwd: "", lifecycle: "active", updatedAt: "", turnId: "t1", title: "a", snippet: "", turnStatus: "completed" }] });
    await render();
    await type("[data-sidebar-search]", "a");
    await click("[data-old-tasks-start]");
    expect($("[data-old-task]")).not.toBeNull();
    // Results stay: a cursor is left (8 pages read automatically, then 继续查找).
    expect($("[data-old-tasks-more]")).not.toBeNull();
    await act(async () => useApp.setState((s) => ({ hosts: { ...s.hosts!, hosts: s.hosts!.hosts.map((x) => (x.id === "local" ? { ...x, conn: { ...x.conn!, epoch: "e-local-2" } } : x)) } })));
    await settle();
    expect($("[data-old-tasks-results]")).toBeNull();
  });

  const hit = (sessionId: string, turnId: string) => ({ hostId: "HOST-A", cutexSessionId: sessionId, displayName: sessionId, cwd: "", lifecycle: "active" as const, updatedAt: "", turnId, title: turnId, snippet: "", turnStatus: "completed" as const });

  it("changing or clearing the text, or 已归档, drops the search: a late reply is discarded and 继续查找 goes", async () => {
    setup({ localSearch: true });
    const pending: ((r: SessionSearchResponse) => void)[] = [];
    setSessionSearchApi((hostId) => ({ sessionSearch: (query) => { calls.push({ hostId, query }); return new Promise((r) => pending.push(r)); } }));
    await render();
    await type("[data-sidebar-search]", "flush");
    await click("[data-old-tasks-start]");
    expect(calls).toHaveLength(1);
    await type("[data-sidebar-search]", "flus");
    await settle();
    expect($("[data-old-tasks-results]")).toBeNull();
    await act(async () => pending.shift()!({ contractVersion: 2, hostId: "HOST-A", mode: "tasks", nextCursor: "more", more: true, partial: false, items: [hit("l1", "t1")] }));
    await settle();
    expect($("[data-old-task]")).toBeNull();
    expect(calls).toHaveLength(1);
    // A new search; 已归档 toggled afterwards drops it too, and its 继续查找 with it.
    await click("[data-old-tasks-start]");
    await act(async () => pending.shift()!({ contractVersion: 2, hostId: "HOST-A", mode: "tasks", nextCursor: null, more: false, partial: false, items: [hit("l1", "t2")] }));
    await settle();
    expect($("[data-old-task]")).not.toBeNull();
    await click("[data-old-tasks-archived]");
    expect($("[data-old-tasks-results]")).toBeNull();
    await type("[data-sidebar-search]", "");
    await settle();
    expect($("[data-old-tasks]")).toBeNull();
  });

  it("a directory filter whose host left the scope is suspended: searches go to the hosts in view, blur asks nothing", async () => {
    setup({ localSearch: true, alphaSearch: true });
    await render();
    await click("[data-sidebar-dir-toggle]");
    const picker = $("[data-sidebar-dir-host]") as HTMLSelectElement;
    await act(async () => { picker.value = "alpha"; picker.dispatchEvent(new Event("change", { bubbles: true })); });
    await type("[data-sidebar-dir-path]", "/srv/far");
    await act(async () => $("[data-sidebar-dir-path]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await settle();
    expect(calls).toEqual([{ hostId: "alpha", query: { mode: "sessions", cwd: "/srv/far" } }]);
    // The scope becomes this PC only: alpha is out of view.
    await act(async () => useApp.setState((st) => ({ hosts: { ...st.hosts!, scope: { kind: "host", id: "local" } } })));
    await settle();
    expect($("[data-sidebar-dir-status]")?.textContent).toMatch(/working directory right now/);
    // Not applied: this PC's rows show.
    expect(has("Moss")).toBe(true);
    await act(async () => { ($("[data-sidebar-dir-path]") as HTMLInputElement).focus(); });
    await type("[data-sidebar-dir-path]", "/srv/other");
    await act(async () => { ($("[data-sidebar-dir-path]") as HTMLInputElement).blur(); });
    await settle();
    expect(calls).toHaveLength(1);
    await type("[data-sidebar-search]", "Moss");
    await click("[data-old-tasks-start]");
    expect(calls.at(-1)).toEqual({ hostId: "local", query: { mode: "tasks", q: "Moss" } });
  });

  it("a search with no matching agent says so, never the empty-roster words (owner 2026-11-25)", async () => {
    setup({ localSearch: false });
    await render();
    await type("[data-sidebar-search]", "zzzz-nothing");
    await settle();
    const empty = $("[data-roster-empty]");
    expect(empty?.dataset.rosterEmpty).toBe("noMatch");
    expect(empty?.textContent).not.toMatch(/还没有|yet/);
  });

  it("a delegation id looks the delegation up (hosts with delegations); one written as an id offers no 查找旧任务", async () => {
    setup({ localSearch: true });
    useApp.setState({ features: new Set(["session-search-v1", "agent-asks"]) });
    await render();
    await type("[data-sidebar-search]", "#47c47e");
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    await settle();
    expect($("[data-delegation-id]")).not.toBeNull();
    // The bridge mock has no delegations: the lookup ends with none found.
    expect($("[data-delegation-id-none]")).not.toBeNull();
    expect($("[data-old-tasks-start]")).toBeNull();
    // A bare abbreviation could be text too: both.
    await type("[data-sidebar-search]", "47c47e");
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    await settle();
    expect($("[data-delegation-id]")).not.toBeNull();
    expect($("[data-old-tasks-start]")).not.toBeNull();
    // Not an id: no delegation section.
    await type("[data-sidebar-search]", "Moss");
    await settle();
    expect($("[data-delegation-id]")).toBeNull();
  });

  it("a host with delegations but no session search is asked too (the lane is shared, not its host list)", async () => {
    setup({ localSearch: false });
    useApp.setState({ features: new Set(["agent-asks"]) });
    await render();
    await type("[data-sidebar-search]", "#47c47e");
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    await settle();
    expect(bridgeCalls.filter((m) => m === "asks")).toHaveLength(1);
    expect($("[data-delegation-id-none]")).not.toBeNull();
    // A hex word without a digit is text, not an id: no list read.
    await type("[data-sidebar-search]", "facade");
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    await settle();
    expect($("[data-delegation-id]")).toBeNull();
    expect(bridgeCalls.filter((m) => m === "asks")).toHaveLength(1);
  });

  it("a host without delegations is not asked for an id", async () => {
    setup({ localSearch: true });
    await render();
    await type("[data-sidebar-search]", "#47c47e");
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    await settle();
    expect($("[data-delegation-id]")).toBeNull();
  });
});
