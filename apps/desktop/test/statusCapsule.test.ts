import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { applyEvent, emptyTimeline, planFromLatest, planSnapshotOf, seedPlan, timelineFromThreadRead, type PlanSnapshot } from "../src/renderer/src/lib/timeline";
import { focusWindow, foldKind, latestPlan, planProgress, planSignature, type PlanStep } from "../src/renderer/src/lib/statusCapsule";

function native(method: string, params: unknown): EventEnvelope {
  return {
    contractVersion: 2,
    eventId: "e",
    cursor: "c",
    streamId: "s",
    sequence: 1,
    receivedAt: "",
    cutexSessionId: "me",
    hostId: "h",
    source: "app_server",
    sensitivity: "owner",
    correlation: {},
    native: { kind: "notification", message: { method, params } },
  };
}

const planUpdated = (turnId: string, plan: PlanStep[], explanation: string | null = null) => native("turn/plan/updated", { threadId: "t", turnId, explanation, plan });

const steps = (statuses: PlanStep["status"][]): PlanStep[] => statuses.map((status, i) => ({ step: `s${i}`, status }));

/** thread/read of thread "t" with the given turn ids (each with one agent message). */
const threadRead = (...turnIds: string[]) => ({ thread: { id: "t", turns: turnIds.map((id) => ({ id, status: "completed", items: [{ type: "agentMessage", id: `m-${id}`, text: "hi" }] })) } });

describe("latestPlan", () => {
  it("is null without an update_plan snapshot — thread/read never carries one", () => {
    expect(latestPlan(null)).toBeNull();
    expect(latestPlan(timelineFromThreadRead(threadRead("a")))).toBeNull();
  });

  it("returns the newest snapshot across turns, replaced in place within a turn", () => {
    const state = emptyTimeline();
    applyEvent(state, planUpdated("turn-1", steps(["completed", "inProgress"])));
    applyEvent(state, planUpdated("turn-2", steps(["inProgress", "pending", "pending"]), "first"));
    expect(latestPlan(state)?.turnId).toBe("turn-2");
    applyEvent(state, planUpdated("turn-2", steps(["completed", "inProgress", "pending"]), "second"));
    const plan = latestPlan(state)!;
    expect(plan.explanation).toBe("second");
    expect(planProgress(plan.steps)).toEqual({ done: 1, total: 3 });
    // The timeline keeps one checklist entry per turn (the one-line "更新了进程" row).
    expect([...state.entries.values()].filter((e) => e.kind === "checklist").map((e) => e.id)).toEqual(["checklist:turn-1", "checklist:turn-2"]);
  });

  it("an empty snapshot keeps the previous list, marked cleared, until a new non-empty one", () => {
    const state = emptyTimeline();
    applyEvent(state, planUpdated("turn-1", steps(["pending"])));
    applyEvent(state, planUpdated("turn-2", []));
    expect(latestPlan(state)).toMatchObject({ turnId: "turn-1", cleared: true });
    applyEvent(state, planUpdated("turn-3", steps(["inProgress"])));
    expect(latestPlan(state)?.turnId).toBe("turn-3");
    expect(latestPlan(state)?.cleared).toBeUndefined();
  });

  it("a dismissed plan is not shown", () => {
    const state = emptyTimeline();
    applyEvent(state, planUpdated("turn-1", steps(["pending"])));
    state.plan = { ...state.plan!, dismissed: true };
    expect(latestPlan(state)).toBeNull();
    applyEvent(state, planUpdated("turn-1", steps(["completed"])));
    expect(latestPlan(state)?.steps[0]!.status).toBe("completed");
  });

  it("signature changes with any step status", () => {
    const state = emptyTimeline();
    applyEvent(state, planUpdated("turn-1", steps(["inProgress", "pending"])));
    const a = planSignature(latestPlan(state));
    applyEvent(state, planUpdated("turn-1", steps(["completed", "inProgress"])));
    expect(planSignature(latestPlan(state))).not.toBe(a);
    expect(planSignature(null)).toBe("");
  });
});

describe("planSnapshotOf / seedPlan", () => {
  const cached: PlanSnapshot = { threadId: "t", turnId: "b", explanation: null, steps: steps(["completed", "inProgress"]) };

  it("reads turn/plan/updated envelopes only", () => {
    expect(planSnapshotOf(planUpdated("x", steps(["pending"]), "why"))).toEqual({ threadId: "t", turnId: "x", explanation: "why", steps: steps(["pending"]) });
    expect(planSnapshotOf(native("turn/started", { turn: { id: "x" } }))).toBeNull();
  });

  it("re-seeds a rebuilt timeline from the last snapshot seen for its thread", () => {
    const state = timelineFromThreadRead(threadRead("a", "b"));
    expect(seedPlan(state, cached)).toBe(true);
    expect(latestPlan(state)).toBe(cached);
    // Capsule only: the timeline gets no checklist row (its position in the turn is unknown).
    expect([...state.entries.values()].some((e) => e.kind === "checklist")).toBe(false);
  });

  it("skips another thread or a timeline that already has a live plan; a turn not loaded is fine (reverts: lib/planState)", () => {
    expect(seedPlan(timelineFromThreadRead(threadRead("a", "b")), { ...cached, threadId: "other" })).toBe(false);
    expect(seedPlan(timelineFromThreadRead(threadRead("a")), cached)).toBe(true);
    expect(seedPlan(timelineFromThreadRead(threadRead("a", "b")), undefined)).toBe(false);
    const live = timelineFromThreadRead(threadRead("a", "b"));
    applyEvent(live, planUpdated("b", steps(["completed", "completed"])));
    expect(seedPlan(live, cached)).toBe(false);
    expect(planProgress(latestPlan(live)!.steps).done).toBe(2);
  });

  it("maps cutex latestPlan (recovered from the rollout) to a seedable snapshot", () => {
    const latest = { threadId: "t", turnId: "b", explanation: "why", plan: steps(["completed", "pending"]), updatedAt: "2026-10-07T00:00:00Z" };
    expect(planFromLatest(latest)).toEqual({ threadId: "t", turnId: "b", explanation: "why", steps: steps(["completed", "pending"]) });
    expect(planFromLatest(null)).toBeNull();
    expect(planFromLatest(undefined)).toBeNull();
    expect(seedPlan(timelineFromThreadRead(threadRead("a", "b")), planFromLatest(latest))).toBe(true);
  });
});

describe("focusWindow", () => {
  it("shows short lists whole", () => {
    const w = focusWindow(steps(["completed", "inProgress", "pending"]));
    expect(w.compact).toBe(false);
    expect(w.focus).toHaveLength(3);
  });

  it("anchors on the in-progress step, keeping order", () => {
    const list = steps(["completed", "completed", "completed", "inProgress", "pending", "pending", "pending", "pending"]);
    const w = focusWindow(list);
    expect(w.compact).toBe(true);
    expect(w.before.map((s) => s.step)).toEqual(["s0", "s1", "s2"]);
    expect(w.focus.map((s) => s.step)).toEqual(["s3", "s4", "s5"]);
    expect(w.after.map((s) => s.step)).toEqual(["s6", "s7"]);
    expect(foldKind("before", w.before)).toBe("completed");
    expect(foldKind("after", w.after)).toBe("pending");
  });

  it("pulls the window back near the end so it stays full", () => {
    const w = focusWindow(steps(["completed", "completed", "completed", "completed", "completed", "completed", "inProgress"]));
    expect(w.focus.map((s) => s.step)).toEqual(["s4", "s5", "s6"]);
    expect(w.after).toEqual([]);
  });

  it("falls back to the first unfinished step, then to the tail", () => {
    const w = focusWindow(steps(["completed", "pending", "completed", "pending", "pending", "pending", "pending"]));
    expect(w.focus[0]!.step).toBe("s1");
    expect(foldKind("after", w.after)).toBe("pending");
    const done = focusWindow(steps(Array(7).fill("completed")));
    expect(done.focus.map((s) => s.step)).toEqual(["s4", "s5", "s6"]);
  });

  it("labels mixed groups as earlier / later", () => {
    expect(foldKind("before", steps(["completed", "pending"]))).toBe("earlier");
    expect(foldKind("after", steps(["pending", "completed"]))).toBe("later");
  });
});
