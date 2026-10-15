import { describe, expect, it } from "vitest";
import { cloneTimeline, historyPageSize, MAX_PAGE_TURNS, olderAfterPage, olderFromPage, prependHistory } from "../src/renderer/src/lib/historyPages";
import { orderedEntries, seedPlan, timelineFromThreadRead } from "../src/renderer/src/lib/timeline";
import { recordedSteers } from "../src/renderer/src/lib/pendingSteers";

const turn = (n: number, extra: Record<string, unknown>[] = []) => ({
  id: `t${n}`,
  status: "completed",
  startedAt: n,
  completedAt: n,
  items: [{ type: "userMessage", id: `u${n}`, content: [{ type: "text", text: `q${n}` }] }, { type: "agentMessage", id: `a${n}`, text: `r${n}` }, ...extra],
});
const read = (threadId: string, ...ns: number[]) => ({ thread: { id: threadId, turns: ns.map((n) => turn(n)) } });
const page = (nextCursor: string | null) => ({ limit: 2, cursor: null, nextCursor, hasMore: nextCursor !== null });

describe("history pages", () => {
  it("fetches as many turns first as the 长对话 pref renders (全部 = one full read)", () => {
    expect(historyPageSize(30)).toBe(30);
    expect(historyPageSize(0)).toBeUndefined();
    expect(historyPageSize(1000)).toBe(MAX_PAGE_TURNS);
  });

  it("pages only when cutex reported a page (older cutex sends every turn)", () => {
    expect(olderFromPage(undefined)).toBeNull();
    expect(olderFromPage(null)).toBeNull();
    expect(olderFromPage(page(null))).toEqual({ cursor: null, loading: false, error: null, added: 0 });
    expect(olderFromPage(page("c1"))?.cursor).toBe("c1");
  });

  it("counts prepended turns and stops on the last page or a repeated cursor", () => {
    const first = olderAfterPage(olderFromPage(page("c1")), page("c2"), 2, "c1");
    expect(first).toEqual({ cursor: "c2", loading: false, error: null, added: 2 });
    expect(olderAfterPage(first, page(null), 1, "c2")).toEqual({ cursor: null, loading: false, error: null, added: 3 });
    expect(olderAfterPage(first, page("c2"), 0, "c2").cursor).toBeNull();
  });

  it("prepends an older page in order, skipping turns and items already loaded", () => {
    const state = timelineFromThreadRead(read("th", 3, 4));
    expect(prependHistory(state, read("th", 1, 2, 3))).toBe(2);
    expect(state.turns.map((t) => t.id)).toEqual(["t1", "t2", "t3", "t4"]);
    expect(orderedEntries(state).map((e) => e.id)).toEqual(["u1", "a1", "u2", "a2", "u3", "a3", "u4", "a4"]);
    // The live turn stays the active one.
    state.activeTurnId = "t4";
    expect(prependHistory(state, read("th", 0))).toBe(1);
    expect(state.activeTurnId).toBe("t4");
    expect(state.turns[0]!.id).toBe("t0");
  });

  it("ignores a page of another thread", () => {
    const state = timelineFromThreadRead(read("th", 3));
    expect(prependHistory(state, read("other", 1, 2))).toBe(0);
    expect(state.turns.map((t) => t.id)).toEqual(["t3"]);
  });

  it("completes a copy for export without touching the view", () => {
    const view = timelineFromThreadRead(read("th", 3, 4));
    const full = cloneTimeline(view);
    prependHistory(full, read("th", 1, 2));
    expect(full.turns.map((t) => t.id)).toEqual(["t1", "t2", "t3", "t4"]);
    expect(view.turns.map((t) => t.id)).toEqual(["t3", "t4"]);
    expect(view.entries.has("u1")).toBe(false);
  });

  it("still finds a steer in the newest page (the steer check reads only recent turns)", () => {
    const recent = timelineFromThreadRead({ thread: { id: "th", turns: [{ ...turn(9), items: [...turn(9).items, { type: "userMessage", id: "s1", clientId: "steer-1", content: [{ type: "text", text: "also" }] }] }] } });
    expect([...recordedSteers([{ id: "steer-1", text: "also", imageCount: 0, turnId: "t9", baseline: 0 }], recent)]).toEqual(["steer-1"]);
  });
});

describe("seedPlan with older turns not loaded", () => {
  const plan = { threadId: "th", turnId: "t1", explanation: null, steps: [{ step: "a", status: "completed" as const }] };
  it("accepts a plan of the same thread whose turn is older than the loaded page", () => {
    expect(seedPlan(timelineFromThreadRead(read("th", 5, 6)), plan)).toBe(true);
    expect(seedPlan(timelineFromThreadRead(read("th", 5, 6)), { ...plan, threadId: "other" })).toBe(false);
  });
});
