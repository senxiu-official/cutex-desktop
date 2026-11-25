// 查找旧任务 / 工作目录 state (lib/sessionSearchStore, harness C3): one pending request per host, a small automatic page
// budget then 继续查找 (also after an empty page with a cursor), a rejected cursor restarts that host once, superseded
// replies are dropped, empty completion only when no host has a cursor, and a result opens through lib/jump.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jumpToTurn = vi.fn(async () => ({ status: "focused" as const }));
vi.mock("../src/renderer/src/lib/jump", () => ({ jumpToTurn: (...args: unknown[]) => jumpToTurn(...(args as [])) }));
vi.mock("../src/renderer/src/bridge", () => {
  const api = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : () => Promise.resolve(null)) });
  return { api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m };
});

import type { SessionSearchQuery, SessionSearchResponse } from "../src/shared/sessionSearch";
import { useApp } from "../src/renderer/src/store";
import {
  clearTaskSearch,
  continueTaskSearch,
  dropStaleTaskSearch,
  openTaskHit,
  refreshDirFilter,
  resetSearchLanes,
  setArchivedSearch,
  setDirFilter,
  setSearchHosts,
  setSessionSearchApi,
  startTaskSearch,
  TASK_AUTO_PAGES,
  taskSearchStatus,
  useSessionSearch,
} from "../src/renderer/src/lib/sessionSearchStore";
import { matchRuns, snippetAdds } from "../src/renderer/src/lib/sessionSearchView";

type Reply = SessionSearchResponse | Error;
const taskPage = (items: { s: string; t: string }[], nextCursor: string | null, partial = false): SessionSearchResponse => ({
  contractVersion: 2,
  hostId: "name",
  mode: "tasks",
  nextCursor,
  more: nextCursor !== null,
  partial,
  items: items.map(({ s, t }) => ({ hostId: "name", cutexSessionId: s, displayName: s, cwd: "/w", lifecycle: "active", updatedAt: "", turnId: t, title: `title ${t}`, snippet: "", turnStatus: "completed" })),
});
const sessionsPage = (ids: string[], nextCursor: string | null, partial = false): SessionSearchResponse => ({ contractVersion: 2, hostId: "name", mode: "sessions", nextCursor, more: nextCursor !== null, partial, items: ids.map((id) => ({ hostId: "name", cutexSessionId: id, displayName: id, cwd: "/w", lifecycle: "active", updatedAt: "" })) });

/** Per host: queued replies; each call waits until released (so pending requests can be counted). */
function fakeHosts() {
  const calls: { hostId: string; query: SessionSearchQuery }[] = [];
  const queues = new Map<string, Reply[]>();
  const waiting: (() => void)[] = [];
  let inflight = new Map<string, number>();
  let maxInflight = 0;
  setSessionSearchApi((hostId) => ({
    async sessionSearch(query) {
      calls.push({ hostId, query });
      inflight.set(hostId, (inflight.get(hostId) ?? 0) + 1);
      maxInflight = Math.max(maxInflight, inflight.get(hostId)!);
      await new Promise<void>((r) => waiting.push(r));
      inflight.set(hostId, inflight.get(hostId)! - 1);
      const next = queues.get(hostId)?.shift() ?? taskPage([], null);
      if (next instanceof Error) throw next;
      return next;
    },
  }));
  return {
    calls,
    queue: (hostId: string, ...replies: Reply[]) => queues.set(hostId, [...(queues.get(hostId) ?? []), ...replies]),
    /** Release every waiting call, repeatedly, until nothing is waiting. */
    async drain() {
      for (let i = 0; i < 200; i++) {
        await new Promise((r) => setTimeout(r, 0));
        if (!waiting.length) {
          await new Promise((r) => setTimeout(r, 0));
          if (!waiting.length) return;
        }
        waiting.splice(0).forEach((r) => r());
      }
    },
    async step() {
      await new Promise((r) => setTimeout(r, 0));
      waiting.splice(0).forEach((r) => r());
      await new Promise((r) => setTimeout(r, 0));
    },
    get maxInflight() {
      return maxInflight;
    },
    reset() {
      inflight = new Map();
    },
  };
}

beforeEach(() => {
  resetSearchLanes();
  setSearchHosts(null);
  setArchivedSearch(false);
  clearTaskSearch();
  void setDirFilter(null);
  jumpToTurn.mockClear();
});
afterEach(() => setSessionSearchApi(null));

describe("查找旧任务", () => {
  it("reads each host's pages in turn (one pending per host), hosts side by side, keyed by connection", async () => {
    const f = fakeHosts();
    f.queue("local", taskPage([{ s: "eva", t: "t3" }], "c1"), taskPage([{ s: "eva", t: "t1" }], null));
    f.queue("ws", taskPage([{ s: "eva", t: "t3" }], null));
    startTaskSearch({ q: " queue ", targets: [{ hostId: "local", epoch: "e1" }, { hostId: "ws", epoch: "e2" }] });
    await new Promise((r) => setTimeout(r, 0));
    expect(f.calls.map((c) => c.hostId).sort()).toEqual(["local", "ws"]);
    await f.drain();
    expect(f.maxInflight).toBe(1);
    expect(f.calls.map((c) => [c.hostId, c.query])).toEqual([
      ["local", { mode: "tasks", q: "queue" }],
      ["ws", { mode: "tasks", q: "queue" }],
      ["local", { mode: "tasks", q: "queue", cursor: "c1" }],
    ]);
    const { hits, hosts } = useSessionSearch.getState();
    // The same session / turn id on two connections are two results.
    expect(hits.map((h) => h.key)).toEqual([JSON.stringify(["local", "eva", "t3"]), JSON.stringify(["ws", "eva", "t3"]), JSON.stringify(["local", "eva", "t1"])]);
    expect(taskSearchStatus(hosts)).toMatchObject({ pending: false, more: false, complete: true, partial: false });
  });

  it("stops after a few pages; 继续查找 resumes from the last cursor, also after empty pages", async () => {
    const f = fakeHosts();
    const empties = Array.from({ length: TASK_AUTO_PAGES }, (_, i) => taskPage([], `c${i + 1}`));
    f.queue("local", ...empties, taskPage([{ s: "mika", t: "t9" }], null, true));
    startTaskSearch({ q: "x", targets: [{ hostId: "local", epoch: null }], cwd: "/w", retired: true });
    await f.drain();
    expect(f.calls).toHaveLength(TASK_AUTO_PAGES);
    let state = useSessionSearch.getState();
    expect(state.hits).toEqual([]);
    // Not empty yet: a cursor is left.
    expect(taskSearchStatus(state.hosts)).toMatchObject({ more: true, complete: false });
    continueTaskSearch();
    await f.drain();
    expect(f.calls.at(-1)!.query).toEqual({ mode: "tasks", q: "x", cwd: "/w", lifecycle: "retired", cursor: `c${TASK_AUTO_PAGES}` });
    state = useSessionSearch.getState();
    expect(state.hits.map((h) => h.turnId)).toEqual(["t9"]);
    expect(taskSearchStatus(state.hosts)).toMatchObject({ more: false, complete: true, partial: true });
  });

  it("restarts a host from the first page once when its cursor is rejected; a second failure is shown", async () => {
    const f = fakeHosts();
    f.queue("local", taskPage([{ s: "a", t: "1" }], "c1"), new Error("invalid_request: search cursor is invalid or expired"), taskPage([{ s: "a", t: "1" }], "c1b"), new Error("invalid_request: search cursor belongs to another query"));
    startTaskSearch({ q: "x", targets: [{ hostId: "local", epoch: null }] });
    await f.drain();
    expect(f.calls.map((c) => c.query.cursor ?? null)).toEqual([null, "c1", null, "c1b"]);
    const { hits, hosts } = useSessionSearch.getState();
    expect(hits).toHaveLength(1);
    expect(hosts.local!.error).toMatch(/search cursor/);
    expect(taskSearchStatus(hosts)).toMatchObject({ complete: true, failed: ["local"], more: false });
  });

  it("a search dropped before its request went (key changed: scope, connection, filter, text, 已归档) sends nothing", async () => {
    const f = fakeHosts();
    startTaskSearch({ q: "x", targets: [{ hostId: "local", epoch: "e1" }], key: "scope-1" });
    dropStaleTaskSearch("scope-1");
    expect(useSessionSearch.getState().run).not.toBeNull();
    dropStaleTaskSearch("scope-2");
    expect(useSessionSearch.getState().run).toBeNull();
    await f.drain();
    expect(f.calls).toEqual([]);
    expect(useSessionSearch.getState().hits).toEqual([]);
  });

  it("one request per host: a new search waits for the old one's request on the lane; its late reply is discarded", async () => {
    const f = fakeHosts();
    f.queue("local", taskPage([{ s: "late", t: "1" }], "more"), taskPage([{ s: "new", t: "2" }], null));
    startTaskSearch({ q: "a", targets: [{ hostId: "local", epoch: "e1" }] });
    await new Promise((r) => setTimeout(r, 0));
    expect(f.calls.map((c) => c.query.q)).toEqual(["a"]);
    startTaskSearch({ q: "b", targets: [{ hostId: "local", epoch: "e1" }] });
    await new Promise((r) => setTimeout(r, 0));
    // b is queued behind a's request, not sent beside it.
    expect(f.calls.map((c) => c.query.q)).toEqual(["a"]);
    await f.drain();
    expect(f.maxInflight).toBe(1);
    // a's cursor ("more") is never followed: a was dropped.
    expect(f.calls.map((c) => c.query.q)).toEqual(["a", "b"]);
    expect(useSessionSearch.getState().hits.map((h) => h.cutexSessionId)).toEqual(["new"]);
  });

  it("the directory filter and the old-task search share the host's lane", async () => {
    const f = fakeHosts();
    f.queue("local", sessionsPage(["s1"], null), taskPage([], null));
    const dir = setDirFilter({ hostId: "local", path: "/w" });
    startTaskSearch({ q: "x", targets: [{ hostId: "local", epoch: null }] });
    await f.drain();
    await dir;
    expect(f.maxInflight).toBe(1);
    expect(f.calls.map((c) => c.query.mode)).toEqual(["sessions", "tasks"]);
  });

  it("only hosts in scope, online and capable are asked; a host leaving drops its queued page", async () => {
    const f = fakeHosts();
    setSearchHosts(["local"]);
    startTaskSearch({ q: "x", targets: [{ hostId: "local", epoch: null }, { hostId: "gone", epoch: null }] });
    expect(Object.keys(useSessionSearch.getState().hosts)).toEqual(["local"]);
    await setDirFilter({ hostId: "gone", path: "/a" });
    expect(useSessionSearch.getState().dir).toBeNull();
    f.queue("local", taskPage([], "c1"));
    await new Promise((r) => setTimeout(r, 0));
    // local leaves while its first page is in flight: the reply is taken, the next page is never sent, 继续查找 asks nothing.
    setSearchHosts([]);
    await f.drain();
    continueTaskSearch();
    await f.drain();
    expect(f.calls.map((c) => c.hostId)).toEqual(["local"]);
    expect(taskSearchStatus(useSessionSearch.getState().hosts)).toMatchObject({ pending: false });
  });

  it("needs text and a host", () => {
    fakeHosts();
    startTaskSearch({ q: "  ", targets: [{ hostId: "local", epoch: null }] });
    startTaskSearch({ q: "x", targets: [] });
    expect(useSessionSearch.getState().run).toBeNull();
  });
});

describe("工作目录 filter", () => {
  it("collects the session ids under the directory across pages", async () => {
    const f = fakeHosts();
    f.queue("ws", sessionsPage(["a", "b"], "c1"), sessionsPage([], "c2"), sessionsPage(["c"], null, true));
    const done = setDirFilter({ hostId: "ws", path: " /home/alex " }, "e1");
    expect(useSessionSearch.getState()).toMatchObject({ dir: { hostId: "ws", path: "/home/alex" }, dirResult: { ids: null } });
    await f.drain();
    await done;
    expect(f.calls.map((c) => c.query)).toEqual([{ mode: "sessions", cwd: "/home/alex" }, { mode: "sessions", cwd: "/home/alex", cursor: "c1" }, { mode: "sessions", cwd: "/home/alex", cursor: "c2" }]);
    const result = useSessionSearch.getState().dirResult!;
    expect([...result.ids!]).toEqual(["a", "b", "c"]);
    expect(result.incomplete).toBe(true);
  });

  it("reads again for a new connection; a newer filter replaces an older one before its read went", async () => {
    const f = fakeHosts();
    const first = setDirFilter({ hostId: "ws", path: "/a" }, "e1");
    f.queue("ws", sessionsPage(["b"], null));
    const second = setDirFilter({ hostId: "ws", path: "/b" }, "e1");
    await f.drain();
    await Promise.all([first, second]);
    expect(f.calls.map((c) => c.query.cwd)).toEqual(["/b"]);
    expect([...useSessionSearch.getState().dirResult!.ids!]).toEqual(["b"]);
    f.queue("ws", sessionsPage(["b", "b2"], null));
    refreshDirFilter("e1");
    await f.drain();
    expect(f.calls).toHaveLength(1);
    refreshDirFilter("e2");
    await f.drain();
    expect(f.calls).toHaveLength(2);
    expect([...useSessionSearch.getState().dirResult!.ids!]).toEqual(["b", "b2"]);
    await setDirFilter(null);
    expect(useSessionSearch.getState()).toMatchObject({ dir: null, dirResult: null });
  });

  it("shows a failed read", async () => {
    const f = fakeHosts();
    f.queue("ws", new Error("forbidden"));
    const done = setDirFilter({ hostId: "ws", path: "/a" });
    await f.drain();
    await done;
    expect(useSessionSearch.getState().dirResult).toMatchObject({ ids: null, error: "forbidden" });
  });
});

describe("opening a result", () => {
  it("goes straight to lib/jump with the connection (it opens another host's agent itself; test/sessionSearchJump)", async () => {
    const openAgent = vi.fn(async () => {});
    useApp.setState({ hosts: { active: "local", scope: { kind: "all" }, hosts: [{ id: "local" }, { id: "ws" }] } as never, selectedHost: null, openAgent } as never);
    await openTaskHit({ connectionId: "ws", cutexSessionId: "scratch", turnId: "t1" });
    expect(openAgent).not.toHaveBeenCalled();
    expect(jumpToTurn).toHaveBeenLastCalledWith("ws", "scratch", "t1");
  });
});

describe("result text", () => {
  it("marks the searched words without markup from the host", () => {
    expect(matchRuns("Flush the queue, then QUEUE again", "queue")).toEqual([
      { text: "Flush the ", hit: false },
      { text: "queue", hit: true },
      { text: ", then ", hit: false },
      { text: "QUEUE", hit: true },
      { text: " again", hit: false },
    ]);
    expect(matchRuns("<b>x</b>", "")).toEqual([{ text: "<b>x</b>", hit: false }]);
    expect(snippetAdds("修一下队列 flush 的竞态", "修一下队列 flush")).toBe(false);
    expect(snippetAdds("背景：下面是上周…", "…讨论点 1: 队列 flush…")).toBe(true);
    expect(snippetAdds("title", "")).toBe(false);
  });
});
