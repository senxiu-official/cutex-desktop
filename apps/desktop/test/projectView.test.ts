// Project 视图 (modules/project-view/model.ts): grouping and folding of a project's agents, the activity
// derived from delegations / plans / artifacts / services / needs-you, its order and the filters, and the
// pane's params / state.
import { describe, expect, it } from "vitest";
import type { AskSummary, ServiceView } from "../src/shared/ipc";
import {
  ACTIVITY_LIMIT,
  countMembers,
  dedupeKey,
  deriveActivity,
  filterActivity,
  groupMembers,
  IDLE_FOLD_MS,
  initState,
  kindCounts,
  NO_LOAD,
  openDelegationsOf,
  parseParams,
  planSummary,
  restoreState,
  shareActivity,
  tierOf,
  toggleKind,
  type ActivityInput,
  type MemberInput,
  type MemberLoad,
} from "../src/renderer/src/modules/project-view/model";

const NOW = Date.parse("2026-10-21T10:00:00Z");
const min = (n: number) => NOW - n * 60_000;
const iso = (minutesAgo: number) => new Date(min(minutesAgo)).toISOString();

function member(id: string, over: Partial<MemberInput> = {}): MemberInput {
  return { id, name: id, isDirector: false, signal: "idle", online: true, lastActivity: min(1), ...over };
}

function ask(askId: string, from: string | null, to: string, over: Partial<AskSummary> = {}): AskSummary {
  return {
    askId,
    title: `t-${askId}`,
    requester: from ? { kind: "agent", cutexSessionId: from, name: from } : { kind: "owner" },
    target: to,
    targetName: to,
    projectId: "p",
    execution: "running",
    hold: null,
    review: null,
    closed: null,
    attempts: 1,
    createdAt: iso(60),
    updatedAt: iso(30),
    revision: 1,
    ...over,
  } as AskSummary;
}

const input = (over: Partial<ActivityInput> = {}): ActivityInput => ({ projectId: "p", members: new Set(["dir", "a", "b"]), asks: [], plans: [], artifacts: [], services: [], needs: [], ...over });

describe("grouping and folding", () => {
  const load = (over: Partial<MemberLoad> = {}): MemberLoad => ({ ...NO_LOAD, ...over });

  it("errors count as needs-you; running; a finished turn, open work or recent activity stay expanded; long idle folds", () => {
    expect(tierOf(member("x", { signal: "needsYou" }), NO_LOAD, NOW)).toBe("needsYou");
    expect(tierOf(member("x", { signal: "error" }), NO_LOAD, NOW)).toBe("needsYou");
    expect(tierOf(member("x", { signal: "running" }), NO_LOAD, NOW)).toBe("running");
    expect(tierOf(member("x", { signal: "done", lastActivity: min(300) }), NO_LOAD, NOW)).toBe("recent");
    expect(tierOf(member("x", { lastActivity: min(5) }), NO_LOAD, NOW)).toBe("recent");
    // Offline but active a moment ago: still shown.
    expect(tierOf(member("x", { signal: "offline", online: false, lastActivity: min(10) }), NO_LOAD, NOW)).toBe("recent");
    // Long idle with something open (a delegation it waits on, a job, a sub-agent): shown.
    expect(tierOf(member("x", { lastActivity: min(300) }), load({ delegationsOut: 1 }), NOW)).toBe("recent");
    expect(tierOf(member("x", { lastActivity: min(300) }), load({ jobs: 1 }), NOW)).toBe("recent");
    expect(tierOf(member("x", { lastActivity: min(300) }), load({ subagents: 1 }), NOW)).toBe("recent");
    // The fold boundary.
    expect(tierOf(member("x", { lastActivity: NOW - IDLE_FOLD_MS + 1 }), NO_LOAD, NOW)).toBe("recent");
    expect(tierOf(member("x", { lastActivity: NOW - IDLE_FOLD_MS }), NO_LOAD, NOW)).toBe("idle");
    expect(tierOf(member("x", { signal: "offline", online: false, lastActivity: min(200) }), NO_LOAD, NOW)).toBe("idle");
  });

  it("the Director gets its own card (project summary first, else the director row); groups sort by newest activity", () => {
    const members = [
      member("dir", { isDirector: true, signal: "running" }),
      member("r1", { signal: "running", lastActivity: min(3) }),
      member("r2", { signal: "running", lastActivity: min(1) }),
      member("n1", { signal: "error", lastActivity: min(4) }),
      member("n2", { signal: "needsYou", lastActivity: min(2) }),
      member("i1", { lastActivity: min(90) }),
      member("i2", { lastActivity: min(45), online: false, signal: "offline" }),
      member("w", { lastActivity: min(12) }),
    ];
    const g = groupMembers(members, () => NO_LOAD, NOW);
    expect(g.director?.id).toBe("dir");
    expect(g.needsYou.map((m) => m.id)).toEqual(["n2", "n1"]);
    expect(g.running.map((m) => m.id)).toEqual(["r2", "r1"]);
    expect(g.recent.map((m) => m.id)).toEqual(["w"]);
    expect(g.idle.map((m) => m.id)).toEqual(["i2", "i1"]);
    // The summary's Director wins over a stale director flag.
    expect(groupMembers(members, () => NO_LOAD, NOW, { directorId: "w" }).director?.id).toBe("w");
    expect(groupMembers(members, () => NO_LOAD, NOW, { directorId: "w" }).running.map((m) => m.id)).toEqual(["dir", "r2", "r1"]);
    // No director at all.
    expect(groupMembers(members.slice(1), () => NO_LOAD, NOW).director).toBeNull();
  });

  it("只看需要你 keeps the needs-you group only (nothing folded)", () => {
    const members = [member("a", { signal: "running" }), member("b", { signal: "needsYou" }), member("c", { lastActivity: min(500) })];
    const g = groupMembers(members, () => NO_LOAD, NOW, { needsOnly: true });
    expect(g.needsYou.map((m) => m.id)).toEqual(["b"]);
    expect([...g.running, ...g.recent, ...g.idle]).toEqual([]);
  });

  it("counts: online, running and needs-you (errors included)", () => {
    const c = countMembers([member("a", { signal: "running" }), member("b", { signal: "error" }), member("c", { signal: "needsYou" }), member("d", { signal: "offline", online: false })]);
    expect(c).toEqual({ total: 4, online: 3, running: 1, needsYou: 2 });
  });

  it("open delegations of an agent, both ways, newest first; closed / finished ones are not open", () => {
    const asks = [
      ask("1", "dir", "a", { createdAt: iso(50) }),
      ask("2", "dir", "b", { createdAt: iso(10) }),
      ask("3", "a", "b"),
      ask("4", "dir", "a", { execution: "answered", closed: "completed" }),
      ask("5", "dir", "a", { execution: "failed" }),
    ];
    expect(openDelegationsOf(asks, "dir").out.map((a) => a.askId)).toEqual(["2", "1"]);
    expect(openDelegationsOf(asks, "a")).toMatchObject({ in: [{ askId: "1" }], out: [{ askId: "3" }] });
  });
});

describe("activity derivation", () => {
  it("a delegation gives 委托 at its creation, 完成 when answered, 进度 for its notes and 需要你 while it waits for the owner", () => {
    const items = deriveActivity(
      input({
        asks: [
          ask("d1", "dir", "a", { createdAt: iso(50), attempt: { n: 1, state: "running", startedAt: iso(49), progress: [{ text: "half way", at: iso(20) }] } as AskSummary["attempt"] }),
          ask("d2", "dir", "b", { createdAt: iso(40), execution: "answered", attempt: { n: 1, state: "answered", startedAt: iso(39), endedAt: iso(5) } as AskSummary["attempt"], closed: "completed", closedAt: iso(4) }),
          ask("d3", "dir", "b", { createdAt: iso(30), execution: "pendingReview" }),
          ask("d4", null, "a", { createdAt: iso(25), execution: "answered", review: "awaitingAcceptance", attempt: { n: 1, state: "answered", startedAt: iso(24), endedAt: iso(3) } as AskSummary["attempt"] }),
          ask("d5", "dir", "b", { createdAt: iso(35), execution: "failed", closed: "completed", closedAt: iso(8) }),
        ],
      }),
    );
    const ids = items.map((i) => i.id);
    expect(ids).toContain("delegate:d1");
    expect(ids).toContain("note:d1:" + iso(20));
    expect(ids).not.toContain("complete:d1");
    // Completion at the attempt's end (not the later closedAt).
    expect(items.find((i) => i.id === "complete:d2")).toMatchObject({ kind: "complete", at: min(5), actor: "b", failed: false });
    expect(items.find((i) => i.id === "complete:d5")).toMatchObject({ kind: "complete", failed: true });
    // Owner review of a delegation: the requester asked; an owner-made one awaiting acceptance: the target answered.
    expect(items.find((i) => i.id === "needs:d3")).toMatchObject({ kind: "needsYou", reason: "review", actor: "dir" });
    expect(items.find((i) => i.id === "needs:d4")).toMatchObject({ kind: "needsYou", reason: "acceptance", actor: "a" });
    // The owner as requester: actor null.
    expect(items.find((i) => i.id === "delegate:d4")).toMatchObject({ actor: null });
  });

  it("derived again with the same content: the same item objects, by id (perf audit 2026-10-23: memo rows)", () => {
    const build = (extra: AskSummary[] = []) => deriveActivity(input({ asks: [ask("in", "x", "a"), ask("proj", "x", "y"), ...extra] }));
    const first = build();
    const byId = new Map(first.map((i) => [i.id, i]));
    const again = shareActivity(byId, build());
    expect(again).toEqual(first);
    again.forEach((item, n) => expect(item).toBe(first[n]));
    // A new item ahead of the others: the others keep their objects (matched by id, not position).
    const more = shareActivity(byId, build([ask("new", "x", "a")]));
    for (const item of more) if (byId.has(item.id)) expect(item).toBe(byId.get(item.id));
    expect(more.some((i) => !byId.has(i.id))).toBe(true);
  });

  it("only the project's delegations (project id or a member party)", () => {
    const items = deriveActivity(input({ asks: [ask("in", "x", "a", { projectId: "other" }), ask("out", "x", "y", { projectId: "other" }), ask("proj", "x", "y")] }));
    expect(items.filter((i) => i.kind === "delegate").map((i) => i.id).sort()).toEqual(["delegate:in", "delegate:proj"]);
  });

  it("plans, artifacts, services and agents that need you; non-members are dropped", () => {
    const services: ServiceView[] = [
      { slug: "s1", displayName: "S1", ownerCutexSessionId: "a", projectId: null, createdAt: iso(15) } as ServiceView,
      { slug: "s2", displayName: "S2", ownerCutexSessionId: "zzz", projectId: "elsewhere", createdAt: iso(14) } as ServiceView,
      { slug: "s3", displayName: "", ownerCutexSessionId: null, projectId: "p", createdAt: iso(13) } as ServiceView,
    ];
    const items = deriveActivity(
      input({
        plans: [
          { sessionId: "a", at: min(9), done: 2, total: 4, step: "x" },
          { sessionId: "zzz", at: min(8), done: 1, total: 2, step: "y" },
        ],
        artifacts: [{ artifactId: "af-1", version: 2, name: "r.md", at: min(7), sessionId: "b", producerName: "b" }],
        services,
        needs: [
          { sessionId: "b", at: min(2), error: true, text: "boom" },
          { sessionId: "zzz", at: min(1), error: false, text: null },
        ],
      }),
    );
    expect(items.map((i) => i.id)).toEqual(["needs:agent:b", "artifact:af-1:2", "plan:a:" + min(9), "service:s3", "service:s1"]);
    expect(items[1]!.open).toEqual({ kind: "artifact", ref: "af-1@latest", name: "r.md" });
    expect(items.find((i) => i.id === "service:s3")).toMatchObject({ name: "s3", open: { kind: "service", slug: "s3" } });
  });

  it("newest first; equal times by kind order then id; duplicates once; at most ACTIVITY_LIMIT", () => {
    const t = min(5);
    const items = deriveActivity(
      input({
        artifacts: [
          { artifactId: "af-b", version: 1, name: "b", at: t, sessionId: "a", producerName: null },
          { artifactId: "af-a", version: 1, name: "a", at: t, sessionId: "a", producerName: null },
          // The list and a live event: one row.
          { artifactId: "af-a", version: 1, name: "a", at: t, sessionId: "a", producerName: null },
        ],
        plans: [{ sessionId: "a", at: t, done: 1, total: 3, step: null }],
        asks: [ask("d", "dir", "a", { createdAt: new Date(t).toISOString() })],
      }),
    );
    expect(items.map((i) => i.id)).toEqual(["delegate:d", "plan:a:" + t, "artifact:af-a:1", "artifact:af-b:1"]);
    const many = deriveActivity(input({ plans: Array.from({ length: ACTIVITY_LIMIT + 50 }, (_, i) => ({ sessionId: "a", at: min(i + 1), done: 0, total: 1, step: null })) }));
    expect(many).toHaveLength(ACTIVITY_LIMIT);
    expect(many[0]!.at).toBe(min(1));
    // Rows without a time are dropped.
    expect(deriveActivity(input({ plans: [{ sessionId: "a", at: 0, done: 0, total: 1, step: null }] }))).toEqual([]);
  });
});

describe("filters", () => {
  const items = deriveActivity(
    input({
      asks: [ask("d", "dir", "a"), ask("r", "dir", "b", { execution: "pendingReview", createdAt: iso(20) })],
      plans: [{ sessionId: "a", at: min(3), done: 1, total: 2, step: "s" }],
      artifacts: [{ artifactId: "af-1", version: 1, name: "x", at: min(2), sessionId: "b", producerName: null }],
    }),
  );

  it("no chip = everything; chips pick types; 只看需要你 = the 需要你 type only", () => {
    expect(filterActivity(items, [], false)).toHaveLength(items.length);
    expect(filterActivity(items, ["publish"], false).map((i) => i.id)).toEqual(["artifact:af-1:1"]);
    expect(filterActivity(items, ["delegate", "progress"], false).map((i) => i.kind).sort()).toEqual(["delegate", "delegate", "progress"]);
    expect(filterActivity(items, ["publish"], true).map((i) => i.id)).toEqual(["needs:r"]);
  });

  it("chip toggling keeps the chip order; counts per type", () => {
    expect(toggleKind([], "publish")).toEqual(["publish"]);
    expect(toggleKind(["publish"], "delegate")).toEqual(["delegate", "publish"]);
    expect(toggleKind(["delegate", "publish"], "delegate")).toEqual(["publish"]);
    expect(kindCounts(items)).toEqual({ delegate: 2, complete: 0, progress: 1, publish: 1, needsYou: 1 });
  });
});

describe("pane params and state", () => {
  it("params: a project needs its host; the follow tab has no project; one tab per project", () => {
    expect(parseParams({})).toEqual({});
    expect(parseParams(null)).toEqual({});
    expect(parseParams({ hostId: "h", projectId: "p" })).toEqual({ hostId: "h", projectId: "p" });
    expect(parseParams({ projectId: "p" })).toBeNull();
    expect(parseParams([1])).toBeNull();
    expect(dedupeKey({})).toBe("∅");
    expect(dedupeKey({ hostId: "h", projectId: "p" })).not.toBe(dedupeKey({ hostId: "h2", projectId: "p" }));
  });

  it("init keeps the previous filters; restore drops what it does not know", () => {
    const prev = { hostId: "h", projectId: "p", needsOnly: true, kinds: ["publish" as const], idleOpen: true, evKinds: ["turn" as const], evAgent: "cutex.a", runOpen: false };
    expect(initState({ hostId: "h", projectId: "q" }, prev)).toEqual({ ...prev, projectId: "q" });
    expect(initState({}, null)).toEqual({ hostId: null, projectId: null, needsOnly: false, kinds: [], idleOpen: false, evKinds: [], evAgent: null, runOpen: null });
    expect(restoreState({ hostId: "h", projectId: "p", needsOnly: true, kinds: ["publish", "bogus", "publish"], idleOpen: 1 })).toEqual({ hostId: "h", projectId: "p", needsOnly: true, kinds: ["publish"], idleOpen: false, evKinds: [], evAgent: null, runOpen: null });
    expect(restoreState({ evKinds: ["ask", "nope", "ask"], evAgent: "cutex.b", runOpen: true })).toMatchObject({ evKinds: ["ask"], evAgent: "cutex.b", runOpen: true });
    expect(restoreState({ evAgent: 7, runOpen: "yes" })).toMatchObject({ evKinds: [], evAgent: null, runOpen: null });
    expect(restoreState({ projectId: "p" })).toEqual({ hostId: null, projectId: null, needsOnly: false, kinds: [], idleOpen: false, evKinds: [], evAgent: null, runOpen: null });
    expect(restoreState("x")).toBeNull();
  });

  it("plan summary: done / total and the step in progress, else the next pending one", () => {
    expect(planSummary(null)).toBeNull();
    expect(planSummary({ steps: [] })).toBeNull();
    expect(planSummary({ steps: [{ step: "a", status: "completed" }, { step: "b", status: "pending" }, { step: "c", status: "inProgress" }] })).toEqual({ done: 1, total: 3, step: "c" });
    expect(planSummary({ steps: [{ step: "a", status: "completed" }, { step: "b", status: "pending" }] })).toEqual({ done: 1, total: 2, step: "b" });
    expect(planSummary({ steps: [{ step: "a", status: "completed" }] })).toEqual({ done: 1, total: 1, step: null });
  });
});
