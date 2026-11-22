// Re-open flash (2026-11-16, project-lead opened from remote): the cached view is shown at once, the fresh
// bootstrap (10+ s over the relay) brings only the newest turns, and the older turns that were on screen
// vanished. keepPagedTurns keeps them in front of the fresh window.
import { describe, expect, it } from "vitest";
import { keepPagedTurns, olderAfterPage, olderFromPage, prependHistory } from "../src/renderer/src/lib/historyPages";
import { timelineFromThreadRead } from "../src/renderer/src/lib/timeline";

const turn = (n: number, status = "completed") => ({
  id: `t${n}`, status, startedAt: n, completedAt: status === "completed" ? n : null,
  items: [{ type: "userMessage", id: `u${n}`, content: [{ type: "text", text: `q${n}` }] }, { type: "agentMessage", id: `a${n}`, text: `r${n}` }],
});
const read = (threadId: string, ns: number[], last?: string) => ({ thread: { id: threadId, turns: ns.map((n, i) => turn(n, i === ns.length - 1 && last ? last : "completed")) } });
const page = (nextCursor: string | null) => ({ limit: 3, cursor: null, nextCursor, hasMore: nextCursor !== null });

/** The cached view: newest 3 turns (t5–t7) opened, then two older pages (t1–t4) scrolled in. */
function cachedView() {
  const timeline = timelineFromThreadRead(read("th", [5, 6, 7]));
  let older = olderFromPage(page("c5"));
  const added = prependHistory(timeline, read("th", [3, 4]));
  older = olderAfterPage(older, page("c3"), added, "c5");
  return { timeline, older };
}

describe("re-open keeps the older turns the cached view showed", () => {
  it("keeps them in front of the fresh window, with the cached paging state", () => {
    const cached = cachedView();
    // Two turns ran since: the fresh read's newest 3 are t7–t9.
    const fresh = timelineFromThreadRead(read("th", [7, 8, 9]));
    const older = keepPagedTurns(fresh, cached.timeline, cached.older);
    expect(fresh.turns.map((t) => t.id)).toEqual(["t3", "t4", "t5", "t6", "t7", "t8", "t9"]);
    expect([...fresh.entries.keys()]).toEqual(expect.arrayContaining(["u3", "a3", "u6", "a6", "u9"]));
    // Still pages on from where the cached view stopped; the render window keeps every turn it showed.
    expect(older).toEqual({ cursor: "c3", loading: false, error: null, added: 2 + 2 });
  });

  it("keeps nothing for another thread, no overlap, a running turn or a window at the thread start", () => {
    const cached = cachedView();
    expect(keepPagedTurns(timelineFromThreadRead(read("other", [7, 8, 9])), cached.timeline, cached.older)).toBeNull();
    expect(keepPagedTurns(timelineFromThreadRead(read("th", [20, 21, 22])), cached.timeline, cached.older)).toBeNull();
    expect(keepPagedTurns(timelineFromThreadRead(read("th", [3, 4, 5])), cached.timeline, cached.older)).toBeNull();
    const running = timelineFromThreadRead(read("th", [4, 5]));
    running.turns[0]!.status = "inProgress";
    expect(keepPagedTurns(timelineFromThreadRead(read("th", [5, 6])), running, null)).toBeNull();
    expect(keepPagedTurns(timelineFromThreadRead(read("th", [5, 6])), null, null)).toBeNull();
  });

  it("after a revert of the newest turns keeps only turns older than the fresh window", () => {
    const cached = cachedView();
    // t6–t7 reverted: the fresh newest 3 are t3–t5.
    const fresh = timelineFromThreadRead(read("th", [3, 4, 5]));
    expect(keepPagedTurns(fresh, cached.timeline, cached.older)).toBeNull();
    const deeper = timelineFromThreadRead(read("th", [4, 5]));
    expect(keepPagedTurns(deeper, cached.timeline, cached.older)?.cursor).toBe("c3");
    expect(deeper.turns.map((t) => t.id)).toEqual(["t3", "t4", "t5"]);
  });
});

