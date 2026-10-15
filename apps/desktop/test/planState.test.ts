// The kept 进程 snapshot (lib/planState) and its per-agent cache (lib/planCache).
import { describe, expect, it } from "vitest";
import { bootPlan, dismissPlan, nextPlan, planSignature, planTurnGone, revertDropsPlan } from "../src/renderer/src/lib/planState";
import { cachePut, parseCache, planKey } from "../src/renderer/src/lib/planCache";
import type { PlanSnapshot, PlanStep } from "../src/renderer/src/lib/timeline";

const steps = (...statuses: PlanStep["status"][]): PlanStep[] => statuses.map((status, i) => ({ step: `s${i}`, status }));
const plan = (turnId: string, s: PlanStep[], threadId: string | null = "th"): PlanSnapshot => ({ threadId, turnId, explanation: null, steps: s });

describe("nextPlan", () => {
  it("a non-empty snapshot replaces the kept one", () => {
    expect(nextPlan(plan("a", steps("pending")), plan("b", steps("inProgress")))).toEqual(plan("b", steps("inProgress")));
    expect(nextPlan(null, plan("a", steps("pending")))).toEqual(plan("a", steps("pending")));
  });

  it("an empty one keeps the previous list, marked cleared; nothing kept → null", () => {
    const kept = nextPlan(plan("a", steps("completed")), plan("b", []));
    expect(kept).toEqual({ ...plan("a", steps("completed")), cleared: true });
    expect(nextPlan(kept, plan("c", []))).toBe(kept);
    expect(nextPlan(null, plan("a", []))).toBeNull();
    // Another thread's list is not this one's to keep.
    expect(nextPlan(plan("a", steps("completed"), "other"), plan("b", []))).toBeNull();
  });

  it("a new non-empty list clears both flags; a dismissal sticks while the content is the same", () => {
    const dismissed = dismissPlan(plan("a", steps("inProgress")))!;
    expect(dismissed.dismissed).toBe(true);
    expect(nextPlan(dismissed, plan("a", steps("inProgress")))?.dismissed).toBe(true);
    expect(nextPlan(dismissed, plan("a", steps("completed")))?.dismissed).toBeUndefined();
    const cleared = { ...plan("a", steps("completed")), cleared: true, dismissed: true };
    expect(nextPlan(cleared, plan("b", steps("pending")))).toEqual(plan("b", steps("pending")));
  });

  it("the signature ignores the flags (clearing never pulses)", () => {
    const p = plan("a", steps("completed"));
    expect(planSignature({ ...p, cleared: true })).toBe(planSignature(p));
    expect(planSignature(null)).toBe("");
  });

  it("dismissPlan of nothing is nothing; twice is the same object", () => {
    expect(dismissPlan(null)).toBeNull();
    const d = dismissPlan(plan("a", steps("pending")))!;
    expect(dismissPlan(d)).toBe(d);
  });
});

describe("revert detection", () => {
  it("planTurnGone: only a turn that was loaded and is missing while an older one survived", () => {
    expect(planTurnGone("c", ["a", "b", "c"], ["a", "d"], true)).toBe(true);
    expect(planTurnGone("c", ["a", "b", "c"], ["a", "b", "c", "d"], true)).toBe(false);
    // Whole history loaded now and the turn is not in it.
    expect(planTurnGone("c", ["a", "b", "c"], [], false)).toBe(true);
    // Only the newest page loaded now (nothing older overlaps): could just be paged out.
    expect(planTurnGone("a", ["a", "b"], ["x", "y"], true)).toBe(false);
    // Never seen loaded: unknown, kept.
    expect(planTurnGone("z", ["a", "b"], ["a"], false)).toBe(false);
  });

  it("revertDropsPlan: the reverted turn and later ones", () => {
    expect(revertDropsPlan("b", ["a", "b", "c"], "b")).toBe(true);
    expect(revertDropsPlan("c", ["a", "b", "c"], "b")).toBe(true);
    expect(revertDropsPlan("a", ["a", "b", "c"], "b")).toBe(false);
    // Older than the loaded page: earlier than the revert point.
    expect(revertDropsPlan("old", ["a", "b"], "a")).toBe(false);
    expect(revertDropsPlan("a", ["a", "b"], "unknown")).toBe(false);
  });
});

describe("bootPlan", () => {
  const base = { threadId: "th", turns: ["a", "b", "c"], olderUnloaded: false, cachedFresh: false };

  it("takes the local cache for the same thread even when its turn is not loaded", () => {
    const cached = plan("old", steps("completed"));
    expect(bootPlan({ ...base, olderUnloaded: true, cached, latest: null })).toBe(cached);
    expect(bootPlan({ ...base, cached, latest: null })).toBe(cached);
    expect(bootPlan({ ...base, cached: plan("a", steps("pending"), "other"), latest: null })).toBeNull();
    expect(bootPlan({ ...base, threadId: null, cached, latest: null })).toBeNull();
  });

  it("cutex latestPlan alone: non-empty, and (complete history) its turn loaded", () => {
    expect(bootPlan({ ...base, cached: null, latest: plan("b", steps("pending")) })).toEqual(plan("b", steps("pending")));
    expect(bootPlan({ ...base, cached: null, latest: plan("b", []) })).toBeNull();
    expect(bootPlan({ ...base, cached: null, latest: plan("gone", steps("pending")) })).toBeNull();
    expect(bootPlan({ ...base, olderUnloaded: true, cached: null, latest: plan("older", steps("pending")) })).toEqual(plan("older", steps("pending")));
    // latestPlan without a thread id is this session's thread.
    expect(bootPlan({ ...base, cached: null, latest: plan("b", steps("pending"), null) })?.threadId).toBe("th");
  });

  it("the newer of the two by turn order", () => {
    const local = plan("b", steps("completed"));
    expect(bootPlan({ ...base, cached: local, latest: plan("c", steps("pending")) })?.turnId).toBe("c");
    expect(bootPlan({ ...base, cached: local, latest: plan("a", steps("pending")) })).toBe(local);
    // A newer empty latestPlan: the agent cleared its list since.
    expect(bootPlan({ ...base, cached: local, latest: plan("c", []) })).toEqual({ ...local, cleared: true });
    // Local turn not loaded (older page), latest loaded: latest is newer.
    expect(bootPlan({ ...base, olderUnloaded: true, cached: plan("old", steps("pending")), latest: plan("a", steps("pending")) })?.turnId).toBe("a");
  });

  it("same turn: fresh local wins; otherwise the rollout's version, keeping flags when unchanged", () => {
    const local = plan("c", steps("inProgress"));
    const remote = plan("c", steps("completed"));
    expect(bootPlan({ ...base, cachedFresh: true, cached: local, latest: remote })).toBe(local);
    expect(bootPlan({ ...base, cached: local, latest: remote })).toEqual(remote);
    const dismissed = { ...local, dismissed: true };
    expect(bootPlan({ ...base, cached: dismissed, latest: plan("c", steps("inProgress")) })).toBe(dismissed);
    const cleared = { ...local, cleared: true };
    expect(bootPlan({ ...base, cached: cleared, latest: plan("c", steps("inProgress")) })).toBe(cleared);
  });
});

describe("plan cache (LRU)", () => {
  it("puts newest last, removes on null, caps the oldest out", () => {
    let e = cachePut(new Map(), "x", plan("a", steps("pending")), 2);
    e = cachePut(e, "y", plan("b", steps("pending")), 2);
    e = cachePut(e, "x", plan("c", steps("pending")), 2);
    expect([...e.keys()]).toEqual(["y", "x"]);
    e = cachePut(e, "z", plan("d", steps("pending")), 2);
    expect([...e.keys()]).toEqual(["x", "z"]);
    expect([...cachePut(e, "x", null).keys()]).toEqual(["z"]);
  });

  it("round-trips through JSON, keyed per host, skipping malformed rows", () => {
    const key = planKey("workstation", "agent-1");
    const e = cachePut(new Map(), key, { ...plan("a", steps("completed")), cleared: true, dismissed: true });
    const back = parseCache(JSON.parse(JSON.stringify([...e, ["bad", { turnId: 1 }], ["empty", plan("a", [])], 5])));
    expect([...back.keys()]).toEqual([key]);
    expect(back.get(key)).toEqual({ ...plan("a", steps("completed")), cleared: true, dismissed: true });
    expect(planKey("local", "agent-1")).not.toBe(key);
    expect(parseCache({}).size).toBe(0);
    expect(parseCache([["a", plan("x", steps("pending"))], ["b", plan("y", steps("pending"))]], 1).size).toBe(1);
  });
});
