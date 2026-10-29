// Project 「动态」 store (modules/project-view/streamStore.ts): the first page, the live watch from its
// cursor, live rows, 409 → read again, 503 → retry, older pages, sharing / releasing, the host reconnecting,
// and the stop requests.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectEvent, ProjectEventPage, ProjectEventsQuery } from "../src/shared/projectEvents";

const listeners = new Map<string, ((payload: never) => void)[]>();
vi.mock("../src/renderer/src/bridge", () => ({
  api: {},
  apiFor: () => ({}),
  bridge: {
    on: (event: string, f: (payload: never) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), f]);
      return () => listeners.set(event, (listeners.get(event) ?? []).filter((g) => g !== f));
    },
  },
  cleanIpcMessage: (m: string) => m,
}));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { daemonFor: () => ({}) } }));

const S = await import("../src/renderer/src/modules/project-view/streamStore");
const { feedKey } = await import("../src/renderer/src/modules/project-view/stream");

const fire = (event: string, payload: unknown) => (listeners.get(event) ?? []).forEach((f) => f(payload as never));
const row = (seq: number): ProjectEvent => ({
  cursor: `pe:${seq}`,
  at: "2026-10-23T03:00:00.000Z",
  projectId: "p1",
  cutexSessionId: "cutex.a",
  agentName: "a",
  kind: "turn.completed",
  status: "completed",
  title: `t${seq}`,
  detail: null,
  parent: { turnId: `t${seq}`, taskId: null, threadId: null },
  refs: { askId: null, jobId: null, artifactId: null, workflowRunId: null, approvalId: null, notificationId: null },
  source: { method: null, eventCursor: null },
});
const pageOf = (seqs: number[], hasMore: boolean, cursor = "pe:100"): ProjectEventPage => ({ projectId: "p1", streamId: "s1", cursor, earliestCursor: "pe:1", order: "newestFirst", hasMore, events: seqs.map(row) });

type Answer = { ok: true; value: ProjectEventPage } | { ok: false; code: string; message: string };
let pages: Answer[];
let calls: ProjectEventsQuery[];
let watched: { projectId: string; watch: unknown }[];
let unwatched: string[];
let daemon: Record<string, ReturnType<typeof vi.fn>>;

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const feed = (key: string) => S.useProjectStream.getState().feeds[key];
const KEY = feedKey("h1", "p1", undefined, null);

beforeEach(() => {
  S.resetProjectStreams();
  listeners.clear();
  pages = [];
  calls = [];
  watched = [];
  unwatched = [];
  let n = 0;
  daemon = {
    projectEvents: vi.fn(async (_p: string, q: ProjectEventsQuery) => {
      calls.push(q);
      return pages.shift() ?? { ok: true, value: pageOf([], false) };
    }),
    watchProjectEvents: vi.fn(async (projectId: string, watch: unknown) => {
      watched.push({ projectId, watch });
      return `w${++n}`;
    }),
    unwatchProjectEvents: vi.fn(async (id: string) => void unwatched.push(id)),
    projectBackground: vi.fn(async () => ({ ok: true, value: { projectId: "p1", generatedAt: "", jobsAvailable: false, agents: [] } })),
    stopClaudeTask: vi.fn(async () => undefined),
    terminateBackgroundTerminal: vi.fn(async () => undefined),
    cancelJob: vi.fn(async () => ({ ok: false, code: "job_conflict", message: "changed" })),
  };
  S.setStreamDaemon(() => daemon as never);
});
afterEach(() => {
  vi.useRealTimers();
  S.setStreamDaemon(null);
});

describe("project feed", () => {
  it("reads the newest page with the filter, then watches from its cursor and stream", async () => {
    pages.push({ ok: true, value: pageOf([10, 9, 8], true, "pe:120") });
    S.acquireFeed("h1", "p1", ["turn", "ask"], "cutex.a");
    await flush();
    const key = feedKey("h1", "p1", ["turn", "ask"], "cutex.a");
    expect(calls[0]).toEqual({ limit: S.PAGE_SIZE, kinds: ["turn", "ask"], sessionId: "cutex.a" });
    expect(watched[0]).toEqual({ projectId: "p1", watch: { after: "pe:120", streamId: "s1", kinds: ["turn", "ask"], sessionId: "cutex.a" } });
    expect(feed(key)).toMatchObject({ phase: "ready", live: "connecting", older: "pe:8", hasMore: true, streamId: "s1" });
    expect(feed(key)!.rows.map((r) => r.cursor)).toEqual(["pe:10", "pe:9", "pe:8"]);
  });

  it("live rows go on top once; status updates the dot", async () => {
    pages.push({ ok: true, value: pageOf([10, 9], false) });
    S.acquireFeed("h1", "p1", undefined, null);
    await flush();
    fire("projectEvents", { hostId: "h1", epoch: "e", watchId: "w1", kind: "status", status: "live" });
    fire("projectEvents", { hostId: "h1", epoch: "e", watchId: "w1", kind: "event", event: row(11) });
    fire("projectEvents", { hostId: "h1", epoch: "e", watchId: "w1", kind: "event", event: row(11) });
    // Another host's watch with the same id is not ours.
    fire("projectEvents", { hostId: "h2", epoch: "e", watchId: "w1", kind: "event", event: row(12) });
    expect(feed(KEY)!.live).toBe("live");
    expect(feed(KEY)!.rows.map((r) => r.cursor)).toEqual(["pe:11", "pe:10", "pe:9"]);
  });

  it("409 on the watch reads the newest page again (cursor dropped) and watches anew", async () => {
    pages.push({ ok: true, value: pageOf([10], false) }, { ok: true, value: pageOf([30, 29], false, "pe:300") });
    S.acquireFeed("h1", "p1", undefined, null);
    await flush();
    fire("projectEvents", { hostId: "h1", epoch: "e", watchId: "w1", kind: "reset" });
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.before).toBeUndefined();
    expect(calls[1]!.after).toBeUndefined();
    expect(feed(KEY)!.reloads).toBe(1);
    expect(feed(KEY)!.rows.map((r) => r.cursor)).toEqual(["pe:30", "pe:29"]);
    expect((watched[1]!.watch as { after: string }).after).toBe("pe:300");
  });

  it("503 shows 「稍后」 and retries; 404 = gone; a missing route = unsupported", async () => {
    vi.useFakeTimers();
    pages.push({ ok: false, code: "project_events_unavailable", message: "later" }, { ok: true, value: pageOf([5], false) });
    S.acquireFeed("h1", "p1", undefined, null);
    await flush();
    expect(feed(KEY)!.phase).toBe("unavailable");
    expect(watched).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(S.RETRY_MS);
    await flush();
    expect(feed(KEY)!.phase).toBe("ready");
    expect(watched).toHaveLength(1);

    pages.push({ ok: false, code: "project_not_found", message: "no" });
    S.acquireFeed("h1", "gone", undefined, null);
    await flush();
    expect(feed(feedKey("h1", "gone", undefined, null))!.phase).toBe("gone");
    pages.push({ ok: false, code: "unsupported", message: "no route" });
    S.acquireFeed("h1", "old", undefined, null);
    await flush();
    expect(feed(feedKey("h1", "old", undefined, null))!.phase).toBe("unsupported");
  });

  it("older pages use before= the oldest row and the stream id; 409 there starts over", async () => {
    pages.push({ ok: true, value: pageOf([10, 9], true) }, { ok: true, value: pageOf([8, 7], true) });
    S.acquireFeed("h1", "p1", undefined, null);
    await flush();
    await S.loadOlder(KEY);
    expect(calls[1]).toMatchObject({ before: "pe:9", streamId: "s1", limit: S.PAGE_SIZE });
    expect(feed(KEY)!.rows.map((r) => r.cursor)).toEqual(["pe:10", "pe:9", "pe:8", "pe:7"]);
    expect(feed(KEY)!.older).toBe("pe:7");
    pages.push({ ok: false, code: "cursor_expired", message: "old" }, { ok: true, value: pageOf([50], false) });
    await S.loadOlder(KEY);
    await flush();
    expect(feed(KEY)!.reloads).toBe(1);
    expect(feed(KEY)!.rows.map((r) => r.cursor)).toEqual(["pe:50"]);
    // No more pages: nothing is read.
    const before = calls.length;
    await S.loadOlder(KEY);
    expect(calls).toHaveLength(before);
  });

  it("r252 nextCursor: older pages continue from it, also when the first page is empty", async () => {
    pages.push({ ok: true, value: { ...pageOf([], true), nextCursor: "pe:9000" } });
    S.acquireFeed("h1", "p1", undefined, null);
    await flush();
    expect(feed(KEY)).toMatchObject({ phase: "ready", older: "pe:9000", hasMore: true, stalled: false });
    pages.push({ ok: true, value: { ...pageOf([8000, 7999], true), nextCursor: "pe:5000" } });
    await S.loadOlder(KEY);
    expect(calls[1]).toMatchObject({ before: "pe:9000" });
    expect(feed(KEY)).toMatchObject({ older: "pe:5000", hasMore: true });
    pages.push({ ok: true, value: { ...pageOf([4000], false), nextCursor: null } });
    await S.loadOlder(KEY);
    expect(calls[2]).toMatchObject({ before: "pe:5000" });
    expect(feed(KEY)).toMatchObject({ hasMore: false, stalled: false });
    expect(feed(KEY)!.rows.map((r) => r.cursor)).toEqual(["pe:8000", "pe:7999", "pe:4000"]);
  });

  it("an empty older page with hasMore keeps reading, up to EMPTY_HOPS, then waits for the owner", async () => {
    pages.push({ ok: true, value: { ...pageOf([10000], true), nextCursor: "pe:10000" } });
    S.acquireFeed("h1", "p1", undefined, null);
    await flush();
    // Two empty scans, then a row: one loadOlder reads all three.
    pages.push(
      { ok: true, value: { ...pageOf([], true), nextCursor: "pe:9000" } },
      { ok: true, value: { ...pageOf([], true), nextCursor: "pe:8000" } },
      { ok: true, value: { ...pageOf([7500], true), nextCursor: "pe:7500" } },
    );
    await S.loadOlder(KEY);
    expect(calls.slice(1).map((q) => q.before)).toEqual(["pe:10000", "pe:9000", "pe:8000"]);
    expect(feed(KEY)).toMatchObject({ older: "pe:7500", hasMore: true, stalled: false, loadingMore: false });
    // Nothing but empty scans: stop after EMPTY_HOPS, keep the cursor, mark stalled.
    for (let i = 1; i <= S.EMPTY_HOPS + 2; i++) pages.push({ ok: true, value: { ...pageOf([], true), nextCursor: `pe:${7500 - i * 1000}` } });
    const before = calls.length;
    await S.loadOlder(KEY);
    expect(calls.length - before).toBe(S.EMPTY_HOPS);
    expect(feed(KEY)).toMatchObject({ older: `pe:${7500 - S.EMPTY_HOPS * 1000}`, hasMore: true, stalled: true, loadingMore: false });
    // The owner asks again: it goes on from there.
    await S.loadOlder(KEY);
    expect(calls[before + S.EMPTY_HOPS]!.before).toBe(`pe:${7500 - S.EMPTY_HOPS * 1000}`);
  });

  it("without nextCursor (r250 / r251) an empty older page ends the log as before", async () => {
    pages.push({ ok: true, value: pageOf([10, 9], true) }, { ok: true, value: pageOf([], true) });
    S.acquireFeed("h1", "p1", undefined, null);
    await flush();
    await S.loadOlder(KEY);
    expect(calls).toHaveLength(2);
    expect(feed(KEY)).toMatchObject({ older: "pe:9", hasMore: false, stalled: false });
  });

  it("a nextCursor that does not move older stops instead of looping", async () => {
    pages.push({ ok: true, value: { ...pageOf([10, 9], true), nextCursor: "pe:9" } }, { ok: true, value: { ...pageOf([], true), nextCursor: "pe:9" } });
    S.acquireFeed("h1", "p1", undefined, null);
    await flush();
    await S.loadOlder(KEY);
    expect(calls).toHaveLength(2);
    expect(feed(KEY)).toMatchObject({ hasMore: false, stalled: false, loadingMore: false });
    await S.loadOlder(KEY);
    expect(calls).toHaveLength(2);
  });

  it("two views share one feed; the last release unwatches and drops it", async () => {
    pages.push({ ok: true, value: pageOf([1], false) });
    const a = S.acquireFeed("h1", "p1", undefined, null);
    const b = S.acquireFeed("h1", "p1", undefined, null);
    await flush();
    expect(calls).toHaveLength(1);
    a();
    a();
    expect(unwatched).toEqual([]);
    b();
    expect(unwatched).toEqual(["w1"]);
    expect(feed(KEY)).toBeUndefined();
  });

  it("the host disconnecting stops the dot; reconnecting reads again", async () => {
    pages.push({ ok: true, value: pageOf([1], false) }, { ok: true, value: pageOf([2, 1], false) });
    S.acquireFeed("h1", "p1", undefined, null);
    await flush();
    fire("daemonState", { hostId: "h1", epoch: "e", state: { kind: "unreachable", baseUrl: "x", message: "down" } });
    expect(feed(KEY)!.live).toBe("off");
    fire("daemonState", { hostId: "h1", epoch: "e2", state: { kind: "connected", baseUrl: "x", hostId: "H" } });
    await flush();
    expect(calls).toHaveLength(2);
    expect(watched).toHaveLength(2);
    expect(feed(KEY)!.rows).toHaveLength(2);
  });

  it("a failed watch (404) marks the project gone", async () => {
    pages.push({ ok: true, value: pageOf([1], false) });
    S.acquireFeed("h1", "p1", undefined, null);
    await flush();
    fire("projectEvents", { hostId: "h1", epoch: "e", watchId: "w1", kind: "failed", code: "project_not_found", message: "no" });
    expect(feed(KEY)).toMatchObject({ phase: "gone", live: "off" });
  });
});

describe("stop requests", () => {
  it("sends the request the item names; a job conflict says so", async () => {
    expect(await S.sendStop("h1", { kind: "claudeTask", sessionId: "cutex.a", threadId: "th", taskId: "t1" })).toEqual({ ok: true });
    expect(daemon.stopClaudeTask).toHaveBeenCalledWith("cutex.a", "th", "t1");
    expect(await S.sendStop("h1", { kind: "terminal", sessionId: "cutex.b", threadId: "th", processId: "42" })).toEqual({ ok: true });
    expect(daemon.terminateBackgroundTerminal).toHaveBeenCalledWith("cutex.b", "th", "42");
    expect(await S.sendStop("h1", { kind: "job", jobId: "j", expectedRevision: 3 })).toEqual({ ok: false, conflict: true, message: "changed" });
    expect(daemon.cancelJob).toHaveBeenCalledWith("j", 3);
    daemon.stopClaudeTask!.mockRejectedValueOnce(new Error("native_-32600: gone"));
    expect(await S.sendStop("h1", { kind: "claudeTask", sessionId: "cutex.a", threadId: "th", taskId: "t1" })).toEqual({ ok: false, conflict: false, message: "native_-32600: gone" });
  });
});
