// @vitest-environment jsdom
// Old-task search, owner 2026-11-26: results newest first with their time (the turn's, when the host sends it — not in
// session-search-v1, requested), a 发送方 filter greyed until a host can apply it, and 在页面中查找: the search page with
// its own search (filters, flat / by agent, the selected result's turn previewed through history-turn-read, keys).
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const turnCalls: [string, string, string][] = [];
let turnReply: (sessionId: string, turnId: string) => Promise<unknown> = async () => null;
vi.mock("../src/renderer/src/bridge", () => {
  const forHost = (hostId: string) =>
    new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : m === "sessionSearchTurn" ? (s: string, t: string) => (turnCalls.push([hostId, s, t]), turnReply(s, t)) : () => Promise.resolve(null)) });
  const api = forHost("local");
  return { api, apiFor: forHost, bridge: { api, apiFor: forHost, on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m };
});
const jumps: [string, string, string][] = [];
vi.mock("../src/renderer/src/lib/jump", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  jumpToTurn: async (hostId: string, sessionId: string, turnId: string) => (jumps.push([hostId, sessionId, turnId]), { status: "focused" }),
}));
vi.mock("../src/renderer/src/modules/react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOpenPage: () => null,
  usePageOf: () => null,
  useSlot: () => [],
}));

import type { SessionResource } from "@cutex-desktop/protocol";
import { CutexApiError, type CutexClient } from "@cutex-desktop/cutex-client";
import type { SidebarSnapshot } from "../src/shared/ipc";
import { hasV2Filter, parseSessionSearchResponse, parseTurnPreview, sessionSearchParams, type SessionSearchQuery, type SessionSearchResponse, type TaskSearchRow } from "../src/shared/sessionSearch";
import { sessionSearchApi } from "../src/main/sessionSearchApi";
import { setUiPref } from "../src/renderer/src/lib/prefs";
import { useApp } from "../src/renderer/src/store";
import { I18nProvider } from "../src/renderer/src/i18n";
import { en } from "../src/renderer/src/i18n/en";
import { Sidebar } from "../src/renderer/src/components/Sidebar";
import { SessionSearchPage } from "../src/renderer/src/modules/session-search/SessionSearchPage";
import { resetIdLookupLists } from "../src/renderer/src/lib/delegationIdSearch";
import { clearTaskSearch, createTaskSearch, resetSearchLanes, setArchivedSearch, setDirFilter, setSearchChoice, setSearchHosts, setSessionSearchApi, useSessionSearch } from "../src/renderer/src/lib/sessionSearchStore";
import { filtersOf, groupByAgent, hitTurnMs, localDayIso, newestFirst, NO_FILTERS } from "../src/renderer/src/lib/sessionSearchView";
import { SESSION_SEARCH_PAGE } from "../src/renderer/src/lib/sessionSearchPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= function () {};

const NOW = Date.parse("2026-11-26T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

function row(sessionId: string, turnId: string, extra: Partial<TaskSearchRow> = {}): TaskSearchRow {
  return { hostId: "HOST-A", cutexSessionId: sessionId, displayName: sessionId === "l1" ? "Lumen" : sessionId === "l2" ? "Lark" : "Moss", cwd: "D:\\Work", lifecycle: "active", updatedAt: ago(1), turnId, title: `title ${turnId} flush`, snippet: "", turnStatus: "completed", ...extra };
}
const page = (items: TaskSearchRow[], nextCursor: string | null = null): SessionSearchResponse => ({ contractVersion: 2, hostId: "HOST-A", mode: "tasks", items, nextCursor, more: nextCursor !== null, partial: false });

describe("turn times and order", () => {
  it("reads the requested turn times when a host sends them; drops what is not a time", () => {
    const parsed = parseSessionSearchResponse({ ...page([]), items: [{ ...row("l1", "t1"), turnStartedAt: ago(30), turnCompletedAt: ago(29) }, { ...row("l1", "t2"), turnStartedAt: "yesterday" }, row("l2", "t3")] });
    const items = parsed.items as TaskSearchRow[];
    expect(items[0]).toMatchObject({ turnStartedAt: ago(30), turnCompletedAt: ago(29) });
    expect(items[1]).not.toHaveProperty("turnStartedAt");
    expect(items[2]).not.toHaveProperty("turnStartedAt");
    expect(hitTurnMs(items[0]!)).toBe(NOW - 30 * 60_000);
    expect(hitTurnMs(items[2]!)).toBeNull();
  });

  it("newest first by the turn's time; without turn times by the agent's last update, keeping the host's order per agent", () => {
    const hit = (sessionId: string, turnId: string, extra: Partial<TaskSearchRow> = {}) => ({ ...row(sessionId, turnId, extra), connectionId: "local", key: turnId });
    const timed = [hit("l1", "a", { turnStartedAt: ago(90) }), hit("l2", "b", { turnStartedAt: ago(5) }), hit("l1", "c", { turnStartedAt: ago(40) })];
    expect(newestFirst(timed).map((x) => x.key)).toEqual(["b", "c", "a"]);
    const untimed = [hit("l1", "a1", { updatedAt: ago(60) }), hit("l1", "a2", { updatedAt: ago(60) }), hit("l2", "b1", { updatedAt: ago(2) })];
    expect(newestFirst(untimed).map((x) => x.key)).toEqual(["b1", "a1", "a2"]);
    expect(groupByAgent(newestFirst(timed)).map((g) => [g.cutexSessionId, g.hits.map((x) => x.key)])).toEqual([["l2", ["b"]], ["l1", ["c", "a"]]]);
  });
});

describe("the preview's turn (history-turn-read)", () => {
  const answer = (turn: Record<string, unknown>, complete = true) => ({ native: { method: "thread/read", result: { thread: { turns: [turn] } } }, complete });
  it("plain text of the turn's input and replies, its native times; cut turns say so", () => {
    const turn = { id: "t1", status: "completed", startedAt: 1_764_000_000, completedAt: 1_764_000_060, items: [
      { type: "userMessage", content: [{ type: "text", text: "fix the flush" }, { type: "image", url: "x" }] },
      { type: "commandExecution", command: "ls" },
      { type: "agentMessage", text: "<b>done</b>" },
    ] };
    expect(parseTurnPreview(answer(turn), "t1")).toEqual({ turnId: "t1", status: "completed", startedAt: 1_764_000_000, completedAt: 1_764_000_060, truncated: false, messages: [{ role: "input", text: "fix the flush" }, { role: "reply", text: "<b>done</b>" }] });
    expect(parseTurnPreview(answer(turn, false), "t1")!.truncated).toBe(true);
    expect(parseTurnPreview(answer({ ...turn, startedAt: "soon" }), "t1")!.startedAt).toBeNull();
    expect(parseTurnPreview(answer(turn), "other")).toBeNull();
    expect(parseTurnPreview({ native: null }, "t1")).toBeNull();
  });

  it("main: compact read of that turn; a missing turn is null; ids are checked", async () => {
    const historyTurn = vi.fn(async () => answer({ id: "t1", status: "completed", items: [] }));
    const api = sessionSearchApi({ historyTurn } as unknown as CutexClient);
    expect(await api.sessionSearchTurn("l1", "t1")).toMatchObject({ turnId: "t1", messages: [] });
    expect(historyTurn).toHaveBeenCalledWith("l1", "t1", { compact: true });
    historyTurn.mockRejectedValueOnce(new CutexApiError(404, "not_found", "gone"));
    expect(await api.sessionSearchTurn("l1", "t1")).toBeNull();
    await expect(api.sessionSearchTurn("l1", "../x")).rejects.toThrow(/invalid turn/);
    await expect(api.sessionSearchTurn("", "t1")).rejects.toThrow(/invalid turn/);
  });
});

// ---- UI ----

function session(id: string, name: string): SessionResource {
  return { cutexSessionId: id, displayName: name, formalAgentName: name, registrationClass: null, lifecycle: "active", cwd: "D:\\Work", note: null, avatar: null, createdAt: null, activity: { lastConversationAt: ago(5) }, native: { threadId: `t-${id}`, schema: null }, runtime: { status: "online", activeTurnId: null } } as unknown as SessionResource;
}
const AGENTS: [string, string, string][] = [["l1", "Lumen", "home"], ["l2", "Lark", "home"], ["l3", "Moss", "far"]];
const LOCAL = {
  active: AGENTS.map(([id, n]) => session(id, n)),
  retired: [],
  hostRows: Object.fromEntries(AGENTS.map(([id, n, p]) => [id, { id, name: n, kind: "Agent", hostId: "local", profile: null, cwd: null, state: "online", generation: 1, nativeId: null, projectId: p, projectName: null }])),
  projects: { projects: [{ project_id: "home", director_cutex_session_id: null, presentation: { display_name: "Home", badge_label: "H", color: "cyan" } }, { project_id: "far", director_cutex_session_id: null, presentation: { display_name: "Far", badge_label: "F", color: "lime" } }] },
} as unknown as SidebarSnapshot;

let root: Root;
let container: HTMLElement;
const calls: { hostId: string; query: SessionSearchQuery }[] = [];
let reply: (hostId: string, query: SessionSearchQuery) => SessionSearchResponse;
const opened: unknown[] = [];

function setup(features = ["session-search-v1", "history-turn-read"]) {
  useApp.setState({
    hosts: { active: "local", scope: { kind: "host", id: "local" }, hosts: [{ id: "local", kind: "local", label: "This PC", conn: { epoch: "e-local", daemon: { kind: "connected" } } }] } as never,
    daemon: { kind: "connected" } as never,
    selectedId: null,
    features: new Set(features),
    sidebar: LOCAL,
    byHost: {} as never,
    openPage: ((id: string, params: unknown) => opened.push([id, params])) as never,
  });
}
const $ = (sel: string) => container.querySelector<HTMLElement>(sel);
const $$ = (sel: string) => [...container.querySelectorAll<HTMLElement>(sel)];
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
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
async function key(sel: string, k: string) {
  await act(async () => $(sel)!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  setUiPref("sidebarLayout", "roster");
  calls.length = 0;
  jumps.length = 0;
  turnCalls.length = 0;
  opened.length = 0;
  turnReply = async () => null;
  reply = () => page([]);
  setSessionSearchApi((hostId) => ({ async sessionSearch(query) { calls.push({ hostId, query }); return reply(hostId, query); } }));
  resetSearchLanes();
  resetIdLookupLists();
  setSearchHosts(null);
  setArchivedSearch(false);
  setSearchChoice(NO_FILTERS);
  clearTaskSearch();
  void setDirFilter(null);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setSessionSearchApi(null);
  vi.useRealTimers();
});

describe("a search of its own", () => {
  it("the page's search does not touch the sidebar's; the agent filter sends sessionId", async () => {
    reply = (_h, q) => page([row(q.sessionId ?? "l1", "t9")]);
    const s = createTaskSearch();
    s.start({ q: "flush", targets: [{ hostId: "local", epoch: null }], sessionId: "l2" });
    await settle();
    expect(calls.at(-1)!.query).toEqual({ mode: "tasks", q: "flush", sessionId: "l2" });
    expect(s.useStore.getState().hits.map((x) => x.cutexSessionId)).toEqual(["l2"]);
    expect(useSessionSearch.getState().run).toBeNull();
    expect(useSessionSearch.getState().hits).toEqual([]);
    s.dropStale("another key");
    expect(s.useStore.getState().run).toBeNull();
  });
});

describe("sidebar 查找旧任务", () => {
  it("results newest first with their time (only a turn time a host sent); 发送方 greyed; 在页面中查找 opens the page", async () => {
    setup();
    reply = () => page([row("l1", "old", { turnStartedAt: ago(300) }), row("l2", "new", { turnStartedAt: ago(4) }), row("l3", "mid", { turnStartedAt: ago(90) })]);
    await act(async () => root.render(h(I18nProvider, null, h(Sidebar))));
    await settle();
    await type("[data-sidebar-search]", "flush");
    const sender = $("[data-old-tasks-sender] select") as HTMLSelectElement;
    expect(sender.disabled).toBe(true);
    expect($("[data-old-tasks-sender] [data-search-greyed=sender]")!.getAttribute("data-tip")).toBe(en["sidebar.sessionSearch.senderUnavailable"]);
    expect([...sender.options].map((o) => o.text)).toEqual([en["sidebar.sessionSearch.sender.all"], en["sidebar.sessionSearch.sender.owner"], en["sidebar.sessionSearch.sender.agents"].replace("{{agents}}", "agents")]);
    await click("[data-old-tasks-start]");
    expect($$("[data-old-task]").map((b) => JSON.parse(b.getAttribute("data-old-task")!)[2])).toEqual(["new", "mid", "old"]);
    const times = $$("[data-old-task] [data-search-hit-time]");
    expect(times.map((t) => t.textContent)).toEqual(["4 min ago", "1 h ago", "5 h ago"]);
    expect(times[0]!.getAttribute("data-tip")).toMatch(/2026/);
    await click("[data-old-tasks-popout]");
    expect(opened).toEqual([[SESSION_SEARCH_PAGE, { q: "flush" }]]);
  });

  it("no turn time from the host: no time shown, the agent's last update orders them", async () => {
    setup();
    reply = () => page([row("l1", "a", { updatedAt: ago(500) }), row("l2", "b", { updatedAt: ago(3) })]);
    await act(async () => root.render(h(I18nProvider, null, h(Sidebar))));
    await settle();
    await type("[data-sidebar-search]", "flush");
    await click("[data-old-tasks-start]");
    expect($$("[data-old-task]").map((b) => JSON.parse(b.getAttribute("data-old-task")!)[2])).toEqual(["b", "a"]);
    expect($("[data-old-task] [data-search-hit-time]")).toBeNull();
  });
});

describe("the search page", () => {
  const turn = (id: string, startedAt: number | null, reply: string) => ({ turnId: id, status: "completed", startedAt, completedAt: null, truncated: false, messages: [{ role: "input", text: `please flush ${id}` }, { role: "reply", text: reply }] });
  async function open(params: Record<string, string>, features?: string[]) {
    setup(features);
    await act(async () => root.render(h(I18nProvider, null, h(SessionSearchPage, { params }))));
    await settle();
    await settle();
  }

  it("opened with text: searches, newest first, previews the first result (its turn time), keys move and open", async () => {
    reply = () => page([row("l1", "t1", { turnStartedAt: ago(120) }), row("l3", "t3", { turnStartedAt: ago(10) })]);
    turnReply = async (_s, t) => turn(t, t === "t3" ? (NOW - 10 * 60_000) / 1000 : null, `reply ${t}`);
    await open({ q: "flush" });
    expect(calls.map((c) => c.query)).toEqual([{ mode: "tasks", q: "flush" }]);
    expect($$("[data-search-result]").map((r) => JSON.parse(r.getAttribute("data-search-result")!)[2])).toEqual(["t3", "t1"]);
    expect($("[data-search-count]")!.textContent).toBe("2 results");
    expect(turnCalls).toEqual([["local", "l3", "t3"]]);
    expect($("[data-search-preview]")!.textContent).toContain("reply t3");
    expect($("[data-search-preview-time]")!.textContent).toMatch(/^Started /);
    expect($$("[data-search-preview] mark").map((m) => m.textContent)).toContain("flush");
    // ↓ selects (and previews) the next; Enter opens it at that turn; Esc goes back to the field.
    await key("[data-search-results]", "ArrowDown");
    expect($("[data-search-result][aria-selected=true]")!.getAttribute("data-search-result")).toContain("t1");
    expect(turnCalls.at(-1)).toEqual(["local", "l1", "t1"]);
    await key("[data-search-results]", "Enter");
    expect(jumps).toEqual([["local", "l1", "t1"]]);
    await key("[data-search-results]", "Escape");
    expect(document.activeElement).toBe($("[data-search-query]"));
    await click("[data-search-open]");
    expect(jumps.at(-1)).toEqual(["local", "l1", "t1"]);
  });

  it("by agent; time, kind and sender greyed with why; the order note while the host gives no turn times", async () => {
    reply = () => page([row("l1", "a1"), row("l2", "b1"), row("l1", "a2")]);
    await open({ q: "flush" });
    for (const [data, tip] of [["time", "session-search.timeUnavailable"], ["kind", "session-search.kindUnavailable"], ["sender", "sidebar.sessionSearch.senderUnavailable"]] as const) {
      const el = $(`[data-search-greyed=${data}]`)!;
      expect(el.getAttribute("data-tip")).toBe(en[tip].replace("{{agents}}", "agents"));
      expect((el.querySelector("select") as HTMLSelectElement).disabled).toBe(true);
    }
    expect($("[data-search-order-note]")).not.toBeNull();
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("[data-session-search-page] button")].find((b) => b.textContent === "By agent")!.click());
    await settle();
    expect($$("[data-search-group]").map((g) => [g.querySelector("span")!.textContent, [...g.querySelectorAll("[data-search-result]")].length])).toEqual([["Lumen", 2], ["Lark", 1]]);
  });

  it("a host without history-turn-read shows the search's excerpt; nothing is read", async () => {
    reply = () => page([row("l1", "t1", { snippet: "…the flush race…" })]);
    await open({ q: "flush" }, ["session-search-v1"]);
    expect(turnCalls).toEqual([]);
    expect($("[data-search-preview]")!.textContent).toContain(en["session-search.excerptOnly"]);
    expect($("[data-search-preview]")!.textContent).toContain("the flush race");
  });

  it("Enter in the field searches; a changed 已归档 searches again", async () => {
    await open({});
    expect(calls).toEqual([]);
    await type("[data-search-query]", "lark");
    await act(async () => ($("[data-search-query]")!.closest("form") as HTMLFormElement).requestSubmit());
    await settle();
    expect(calls.map((c) => c.query)).toEqual([{ mode: "tasks", q: "lark" }]);
    await click("[data-search-archived]");
    await settle();
    expect(calls.map((c) => c.query).at(-1)).toEqual({ mode: "tasks", q: "lark", lifecycle: "retired" });
  });
});

// ---- cutex r297 session-search-v2 ----

const V2 = ["session-search-v1", "session-search-v2", "history-turn-read"];

describe("search v2: query and rows", () => {
  it("v2 fields send version=2; times, project, kind and sender are checked; sender all is the default", () => {
    expect(sessionSearchParams({ mode: "tasks", q: "x", order: "newest", since: ago(60), kind: "delegations", sender: "agent", projectId: "home" })).toEqual({ mode: "tasks", q: "x", version: "2", order: "newest", since: ago(60), kind: "delegations", sender: "agent", projectId: "home" });
    expect(sessionSearchParams({ mode: "tasks", q: "x", version: 2, sender: "all" })).toEqual({ mode: "tasks", q: "x", version: "2" });
    expect(sessionSearchParams({ mode: "tasks", q: "x" })).toEqual({ mode: "tasks", q: "x" });
    expect(() => sessionSearchParams({ mode: "tasks", q: "x", since: "yesterday" })).toThrow(/invalid since/);
    expect(() => sessionSearchParams({ mode: "tasks", q: "x", since: ago(1), until: ago(5) })).toThrow(/precede/);
    expect(() => sessionSearchParams({ mode: "sessions", kind: "results" })).toThrow(/task mode/);
    expect(() => sessionSearchParams({ mode: "tasks", q: "x", projectId: "a\u0001" })).toThrow(/projectId/);
  });

  it("v2 rows and pages: project, kind, matchedIn, sender, order; unknown values dropped", () => {
    const parsed = parseSessionSearchResponse({ ...page([]), searchVersion: 2, order: "agentUpdatedAt", items: [
      { ...row("l1", "t1"), projectId: "home", turnStartedAt: ago(9), turnCompletedAt: null, kind: "delegations", matchedIn: "delegationBrief", sender: "agent" },
      { ...row("l2", "t2"), projectId: null, kind: "other", matchedIn: "x", sender: "bot" },
    ] });
    expect(parsed).toMatchObject({ searchVersion: 2, order: "agentUpdatedAt" });
    const [a, b] = parsed.items as TaskSearchRow[];
    expect(a).toMatchObject({ projectId: "home", turnStartedAt: ago(9), kind: "delegations", matchedIn: "delegationBrief", sender: "agent" });
    expect(a).not.toHaveProperty("turnCompletedAt");
    expect(b!.projectId).toBeNull();
    expect(b).not.toHaveProperty("kind");
    expect(b).not.toHaveProperty("matchedIn");
    expect(b).not.toHaveProperty("sender");
  });

  it("the controls' choice → filters (presets from now, custom local days with the end day included)", () => {
    expect(filtersOf(NO_FILTERS)).toEqual({});
    expect(hasV2Filter(filtersOf(NO_FILTERS))).toBe(false);
    expect(filtersOf({ sender: "agents", kind: "results", time: "week" })).toEqual({ sender: "agent", kind: "results", since: new Date(NOW - 7 * 86_400_000).toISOString() });
    expect(filtersOf({ ...NO_FILTERS, time: "custom", from: "2026-11-20", to: "2026-11-25" })).toEqual({ since: new Date(2026, 10, 20).toISOString(), until: new Date(2026, 10, 26).toISOString() });
    expect(filtersOf({ ...NO_FILTERS, time: "custom", from: "2026-11-25", to: "2026-11-20" })).toEqual({});
    expect(localDayIso("26/11/2026")).toBeUndefined();
    expect(hasV2Filter({ sender: "all" })).toBe(false);
    expect(hasV2Filter({ sender: "owner" })).toBe(true);
  });

  it("store: v2 hosts get version 2, newest order and the filters; with a filter set a v1 host is left out and named", async () => {
    reply = () => page([]);
    const s = createTaskSearch();
    s.start({ q: "flush", targets: [{ hostId: "local", epoch: null, v2: true }, { hostId: "old", epoch: null }], filters: { kind: "results", sender: "owner" } });
    await settle();
    expect(calls.map((c) => [c.hostId, c.query])).toEqual([["local", { mode: "tasks", q: "flush", version: 2, order: "newest", kind: "results", sender: "owner" }]]);
    expect(s.useStore.getState().run!.skipped).toEqual(["old"]);
    calls.length = 0;
    s.start({ q: "flush", targets: [{ hostId: "local", epoch: null, v2: true }, { hostId: "old", epoch: null }], filters: {} });
    await settle();
    expect(calls.map((c) => [c.hostId, c.query])).toEqual([["local", { mode: "tasks", q: "flush", version: 2, order: "newest" }], ["old", { mode: "tasks", q: "flush" }]]);
    expect(s.useStore.getState().run!.skipped).toEqual([]);
  });
});

describe("search v2: sidebar and page", () => {
  const pick = async (sel: string, value: string) => {
    const el = $(sel) as HTMLSelectElement;
    await act(async () => {
      el.value = value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
  };

  it("sidebar: working 发送方 / 类型 / 时间; a change searches again; results say kind and sender", async () => {
    setup(V2);
    reply = (_h, q) => page(q.sender === "agent" ? [row("l2", "d1", { turnStartedAt: ago(20), kind: "results", sender: "agent", matchedIn: "delegationResult" })] : [row("l1", "m1", { turnStartedAt: ago(5), kind: "messages", sender: "owner" }), row("l2", "d1", { turnStartedAt: ago(20), kind: "results", sender: "agent" })]);
    await act(async () => root.render(h(I18nProvider, null, h(Sidebar))));
    await settle();
    await type("[data-sidebar-search]", "flush");
    expect($("[data-old-tasks-sender]")).toBeNull();
    expect($$("[data-old-tasks-filters] select").map((x) => [x.getAttribute("data-search-filter"), (x as HTMLSelectElement).disabled])).toEqual([["sender", false], ["kind", false], ["time", false]]);
    await click("[data-old-tasks-start]");
    expect(calls.at(-1)!.query).toEqual({ mode: "tasks", q: "flush", version: 2, order: "newest" });
    expect($$("[data-old-task] [data-search-hit-kind]").map((x) => x.textContent)).toEqual(["Results"]);
    expect($$("[data-old-task] [data-search-hit-sender]").map((x) => x.textContent)).toEqual(["Sent by me", "Sent by agents"]);
    await pick("[data-old-tasks-filters] [data-search-filter=sender]", "agents");
    expect(calls.at(-1)!.query).toEqual({ mode: "tasks", q: "flush", version: 2, order: "newest", sender: "agent" });
    expect($$("[data-old-task]")).toHaveLength(1);
  });

  it("page: filters work on v2 (none greyed), custom dates, where it matched", async () => {
    reply = () => page([row("l1", "t1", { turnStartedAt: ago(30), kind: "delegations", matchedIn: "delegationBrief", sender: "agent", projectId: "home" })]);
    turnReply = async (_s, t) => ({ turnId: t, status: "completed", startedAt: null, completedAt: null, truncated: false, messages: [{ role: "input", text: "please flush" }] });
    await openPage({ q: "flush" }, V2);
    expect($("[data-search-greyed]")).toBeNull();
    expect(calls.at(-1)!.query).toEqual({ mode: "tasks", q: "flush", version: 2, order: "newest" });
    expect($("[data-search-matched]")!.textContent).toBe(en["session-search.matched.delegationBrief"]);
    await pick("[data-session-search-page] [data-search-filter=kind]", "delegations");
    expect(calls.at(-1)!.query).toMatchObject({ version: 2, kind: "delegations" });
    await pick("[data-session-search-page] [data-search-filter=time]", "custom");
    expect($("[data-search-from]")).not.toBeNull();
    await type("[data-search-from]", "2026-11-20");
    await settle();
    expect(calls.at(-1)!.query).toMatchObject({ since: new Date(2026, 10, 20).toISOString() });
    expect(calls.at(-1)!.query.until).toBeUndefined();
  });


  it("page: a project of a v2 host is the host's own filter (projectId); only that host is asked", async () => {
    reply = () => page([]);
    await openPage({ q: "flush" }, V2);
    await act(async () => ($("[data-search-project] button") as HTMLButtonElement).click());
    await settle();
    const option = [...document.querySelectorAll<HTMLButtonElement>("[role=option]")].find((o) => o.textContent?.includes("Home"))!;
    await act(async () => option.click());
    await settle();
    expect(calls.at(-1)).toEqual({ hostId: "local", query: { mode: "tasks", q: "flush", version: 2, order: "newest", projectId: "home" } });
  });
});

async function openPage(params: Record<string, string>, features?: string[]) {
  setup(features);
  await act(async () => root.render(h(I18nProvider, null, h(SessionSearchPage, { params }))));
  await settle();
  await settle();
}
