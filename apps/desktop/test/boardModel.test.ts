// 项目看板 model (shared/boardModel.ts, shared/boardBackend.ts, shared/board.ts): per-host reads → one view per
// project. Grouping across hosts goes through projectIdentity only; states and problems come only from cutex facts
// (no "stuck" guessed from quiet time); backend parts (G1/G2/G3/G10) light up only with their capability.
import { describe, expect, it } from "vitest";
import type { ProjectSummary, SessionResource } from "@cutex-desktop/protocol";
import type { AskSummary, SidebarSnapshot } from "../src/shared/ipc";
import { applyBoardPatch, DEFAULT_BOARD_PREFS, parseBoardPrefs, parseBoardTarget, type BoardProjectView } from "../src/shared/board";
import { ASK_STALLED_FEATURE, ASK_STEPS_FEATURE, BOARD_SUMMARY_FEATURE, PROJECT_PLAN_FEATURE, parseBoardSummary } from "../src/shared/boardBackend";
import { buildBoard, healthOf, localDayStart, mergedBackendParts, orderProjects, projectIdentity, quotaExhausted, type BoardHostInput } from "../src/shared/boardModel";
import { demoBoardProjects } from "../src/main/boardDemo";

const NOW = Date.parse("2026-11-17T15:00:00+11:00");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const MIN = 60_000;

function session(id: string, over: Partial<SessionResource> & { activity?: unknown; agentPause?: unknown } = {}): SessionResource {
  return {
    contractVersion: 2, cutexSessionId: id, revision: 1, lifecycle: "active", retiredAt: null, hostId: "h", displayName: id, threadName: null, cwd: null,
    profile: "P", configuredProfile: null, launchedProfile: null, effectiveNextLaunch: { profile: null, source: "" }, groups: [], registrationClass: null, visible: true,
    native: { threadId: null, schema: null },
    runtime: { backend: "codex", status: "online", appServerConnected: true, runtimeGeneration: 1, runtimeAgentId: null, activeTurnId: null, activeTurnObservedAt: null, threadStatus: null, threadSettings: null, requiresVisibleTerminal: false, tuiAttached: false, lastEventAt: null, lastError: null },
    runtimeDefaults: null, activity: null, focus: null, management: null, createdAt: null, updatedAt: null,
    activityStatus: "idle", lastActivityAt: iso(10 * MIN),
    ...over,
  } as SessionResource;
}

function project(id: string, name: string, director: string | null = null): ProjectSummary {
  return { project_id: id, authority_epoch: 1, director_cutex_session_id: director, presentation: { display_name: name, badge_label: "x", color: "blue" }, active_member_count: 0, lifecycle: "active" };
}

function ask(id: string, projectId: string, target: string, over: Partial<AskSummary> = {}): AskSummary {
  return { askId: id, title: `t-${id}`, requester: { kind: "owner" } as never, target, projectId, execution: "running", attempts: 1, createdAt: iso(60 * MIN), updatedAt: iso(30 * MIN), revision: 1, ...over } as AskSummary;
}

function host(hostId: string, projects: ProjectSummary[], members: [SessionResource, string][], over: Partial<BoardHostInput> = {}): BoardHostInput {
  const sidebar: SidebarSnapshot = {
    active: members.map(([s]) => s), retired: [], projects: { schema: "x", projects },
    hostRows: Object.fromEntries(members.map(([s, p]) => [s.cutexSessionId, { id: s.cutexSessionId, name: s.displayName, kind: "agent", hostId, profile: null, projectId: p, cwd: null, state: "", generation: 1, nativeId: null }])),
  };
  return { hostId, label: hostId.toUpperCase(), state: "connected", readAt: NOW, features: null, sidebar, openAsks: [], closedAsks: [], notifications: [], approvals: [], services: [], quotaOut: [], ...over };
}

const only = (list: BoardProjectView[]) => {
  expect(list).toHaveLength(1);
  return list[0]!;
};

describe("project identity", () => {
  it("groups same-name projects across hosts (case / spacing ignored) and keeps each place", () => {
    const a = host("eva", [project("p1", "Waveline", "d1")], [[session("d1"), "p1"], [session("m1", { activityStatus: "busy" }), "p1"]]);
    const b = host("remote", [project("q9", " waveline ", "d2")], [[session("d2"), "q9"], [session("m2"), "q9"]]);
    const p = only(buildBoard([a, b], NOW));
    expect(p.places).toEqual([{ hostId: "eva", projectId: "p1" }, { hostId: "remote", projectId: "q9" }]);
    expect(p.director?.sessionId).toBe("d1");
    // The second host's 主管 is still listed (marked as a 主管), only one is the card's 主管.
    expect(p.members.map((m) => [m.sessionId, m.director])).toEqual([["m1", false], ["d2", true], ["m2", false]]);
    expect(projectIdentity(project("x", "Waveline"))).toBe(projectIdentity(project("y", "WAVELINE")));
    expect(projectIdentity(project("x", "A"))).not.toBe(projectIdentity(project("x", "B")));
  });
});

describe("member states come from the session resource", () => {
  it("busy / offline / error / paused / idle, archived left out", () => {
    const h = host("eva", [project("p", "P", "d")], [
      [session("d", { activityStatus: "busy", busySince: iso(5 * MIN), activity: { lastToolCall: { displayText: "$ cargo test", updatedAt: iso(MIN) } } }), "p"],
      [session("off", { runtime: { ...session("x").runtime, status: "offline" }, activityStatus: "offline" }), "p"],
      [session("err", { runtime: { ...session("x").runtime, status: "error", lastError: "exit 101" } }), "p"],
      [session("old", { activity: { lastTurnError: { turnId: "t1", message: "old failure" } } }), "p"],
      [session("pz", { agentPause: { phase: "paused", cutexSessionId: "pz", requestedAt: iso(MIN), by: "owner" } }), "p"],
      [session("idle"), "p"],
      [session("gone", { archiveKind: "soft" }), "p"],
    ]);
    const p = only(buildBoard([h], NOW));
    expect(p.director).toMatchObject({ state: "busy", doing: "$ cargo test", since: iso(5 * MIN) });
    const st = Object.fromEntries(p.members.map((m) => [m.sessionId, m.state]));
    expect(st).toEqual({ off: "offline", err: "error", old: "idle", pz: "paused", idle: "idle" });
    expect(p.members[0]!.sessionId).toBe("err"); // errored first
    expect(p.counts).toMatchObject({ busy: 1, idle: 2, paused: 1, error: 1, offline: 1 });
    expect(p.problems).toEqual([
      { kind: "agentError", hostId: "eva", subject: "err", detail: "exit 101", target: { kind: "agent", hostId: "eva", sessionId: "err" } },
      { kind: "lastTurnFailed", hostId: "eva", subject: "old", detail: "old failure", target: { kind: "agent", hostId: "eva", sessionId: "old" }, soft: true },
    ]);
  });

  it("a host that is not connected: its agents read offline and the card says so", () => {
    const h = host("remote", [project("p", "P", "d")], [[session("d", { activityStatus: "busy" }), "p"]], { state: "offline" });
    const p = only(buildBoard([h], NOW));
    expect(p.director?.state).toBe("offline");
    expect(p.problems.map((x) => x.kind)).toEqual(["hostOffline"]);
    expect(healthOf(p, NOW)).toBe("problem");
  });
});

describe("delegations, today, needs-you, problems", () => {
  it("counts open delegations; problems only from cutex facts (never from quiet time)", () => {
    const h = host("eva", [project("p", "P", "d")], [[session("d"), "p"], [session("m"), "p"]], {
      openAsks: [
        ask("a1", "p", "m", { attempt: { n: 1, progress: [{ text: "old note", at: iso(6 * 60 * MIN) }] } }),
        ask("a2", "p", "m", { attempt: { n: 2, stopUnconfirmed: true }, ownerQuestions: 1 }),
        ask("a3", "other", "x"),
        ask("a4", "p", "m", { attempt: { n: 1, stalled: true } as never }),
      ],
    });
    const p = only(buildBoard([h], NOW));
    expect(p.counts.openDelegations).toBe(3);
    // a1 quiet for 6 h: no problem; a4 "stalled" ignored without delegation-quiet-v1.
    expect(p.problems.map((x) => [x.kind, x.subject])).toEqual([["stopUnconfirmed", "t-a2"]]);
    expect(p.needsYou).toBe(1);
    expect(p.recent[0]).toMatchObject({ kind: "started" });
  });

  it("stalled and steps show only with their capability", () => {
    const h = host("eva", [project("p", "P")], [[session("m"), "p"]], {
      features: new Set([ASK_STALLED_FEATURE, ASK_STEPS_FEATURE]),
      openAsks: [ask("a4", "p", "m", { targetName: "m", attempt: { n: 1, stalled: true, steps: { done: 3, total: 5 }, progress: [{ text: "gate", at: iso(MIN) }] } as never })],
    });
    const p = only(buildBoard([h], NOW));
    expect(p.problems.map((x) => x.kind)).toEqual(["stalled"]);
    expect(p.recent[0]!.text).toBe("m: gate (3/5)");
  });

  it("today = closed in the local day (any disposition, like finishedToday), failed as a part; unknown when not readable", () => {
    const start = localDayStart(NOW);
    const h = host("eva", [project("p", "P")], [[session("m"), "p"]], {
      closedAsks: [
        ask("c1", "p", "m", { closed: "accepted", closedAt: new Date(start + MIN).toISOString(), execution: "answered" }),
        ask("c2", "p", "m", { closed: "completed", closedAt: new Date(start + 2 * MIN).toISOString(), execution: "answered" }),
        ask("c3", "p", "m", { closed: "stopped", closedAt: new Date(start + 3 * MIN).toISOString(), execution: "failed" }),
        ask("c4", "p", "m", { closed: "accepted", closedAt: new Date(start - MIN).toISOString(), execution: "answered" }),
        ask("c5", "p", "m", { closed: "stopped", closedAt: new Date(start + 4 * MIN).toISOString(), execution: "cancelled" }),
      ],
    });
    // Every delegation closed today counts (c1, c2, c3, c5), failed ones also separately; c4 was yesterday.
    expect(only(buildBoard([h], NOW)).today).toEqual({ done: 4, failed: 1 });
    expect(only(buildBoard([{ ...h, closedAsks: null }], NOW)).today).toBeNull();
  });

  it("needs-you: pending notices of its agents + approvals + owner questions", () => {
    const h = host("eva", [project("p", "P")], [[session("m"), "p"]], {
      notifications: [{ agentId: "m" }, { agentId: "elsewhere" }] as never,
      approvals: [{ projectId: "p", requesterCutexSessionId: "z" }, { projectId: null, requesterCutexSessionId: "m" }, { projectId: "q", requesterCutexSessionId: "m" }] as never,
    });
    expect(only(buildBoard([h], NOW)).needsYou).toBe(3);
  });

  it("an unreachable service and a profile cutex reports at 0 % are problems", () => {
    const h = host("eva", [project("p", "P")], [[session("m", { profile: "Ceobe" }), "p"]], {
      services: [{ slug: "relay", projectId: "p", ownerCutexSessionId: "m", health: "unreachable" }, { slug: "ok", projectId: "p", ownerCutexSessionId: "m", health: "reachable" }] as never,
      quotaOut: ["Ceobe"],
    });
    expect(only(buildBoard([h], NOW)).problems.map((x) => [x.kind, x.subject])).toEqual([["quotaOut", "Ceobe"], ["service", "relay"]]);
    expect(quotaExhausted([{ kind: "window", remainingPercent: 0, stale: false }])).toBe(true);
    expect(quotaExhausted([{ kind: "window", remainingPercent: 3, stale: false }, { kind: "window", remainingPercent: 0, stale: true }])).toBe(false);
  });
});

describe("G1 board summary (project-board-summary-v1)", () => {
  const raw = {
    contractVersion: 1, projects: [{
      projectKey: "inst-1/p", projectId: "p", name: "P", openDelegationsCount: 7, finishedToday: { done: 4, failed: 1 }, needsYouCount: 2,
      problems: { count: 1, items: [{ code: "delegationStalled", id: "a9" }] },
      delegations: [{ askId: "a9", title: "G1 route", target: "m", steps: { done: 2, total: 6, currentStep: null, updatedAt: iso(20 * MIN), source: "progressNote" }, stalled: true, progressNote: { text: "schema done", at: iso(20 * MIN) }, quietSince: iso(20 * MIN) }],
      director: { sessionId: "d", plan: { done: 3, total: 7, currentStep: "gate", updatedAt: iso(MIN), source: "plan" }, goal: { objective: "ship r290", status: "active" }, goalAvailable: true },
    }],
  };
  it("its numbers replace the list reads; plan and goal need project-director-progress-v1", () => {
    const summary = parseBoardSummary(raw)!;
    const h = host("eva", [project("p", "P", "d")], [[session("d"), "p"], [session("m", { activityStatus: "busy" }), "p"]], {
      features: new Set([BOARD_SUMMARY_FEATURE]), summary, openAsks: null, closedAsks: null, notifications: null, approvals: null, services: null, quotaOut: null,
    });
    const p = only(buildBoard([h], NOW));
    expect(p).toMatchObject({ counts: { openDelegations: 7, busy: 1 }, today: { done: 4, failed: 1 }, needsYou: 2, plan: null, goal: null });
    expect(p.places[0]!.projectKey).toBe("inst-1/p");
    expect(p.problems).toEqual([{ kind: "stalled", hostId: "eva", subject: "G1 route", detail: "m", target: { kind: "delegation", hostId: "eva", askId: "a9" } }]);
    const withPlan = only(buildBoard([{ ...h, features: new Set([BOARD_SUMMARY_FEATURE, PROJECT_PLAN_FEATURE, ASK_STEPS_FEATURE]) }], NOW));
    expect(withPlan).toMatchObject({ plan: { done: 3, total: 7, current: "gate" }, goal: "ship r290" });
    expect(withPlan.recent[0]!.text).toBe("m: schema done (2/6)");
    expect(mergedBackendParts([{ features: new Set([BOARD_SUMMARY_FEATURE]) }, { features: null }])).toEqual({ summary: true, steps: false, stalled: false, plan: false });
  });
  it("declared-unavailable sources stay unknown, malformed rows are skipped", () => {
    const s = parseBoardSummary({ projects: [{ projectId: "p", availability: { finishedToday: false, needs: false }, finishedToday: 0, needsYouCount: 0, director: { plan: { done: 9, total: 3 } } }, { nope: 1 }, "x"] })!;
    expect([...s.keys()]).toEqual(["p"]);
    expect(s.get("p")).toMatchObject({ today: null, needsYou: null, plan: null });
    expect(parseBoardSummary({})).toBeNull();
  });
});

// Review P2 (board-window-review C3–C5): each of these fails on 77c8a2eb8.
describe("P6 contract shapes, unknown sources, 主管-bound plan", () => {
  const summaryRaw = (over: Record<string, unknown> = {}) => ({
    contractVersion: 1, availability: { members: true, delegations: true, finishedToday: true, needs: true }, projects: [{
      projectId: "p", projectKey: "origin:i:p", members: { total: 2, busy: 0, idle: 2, offline: 0, paused: 0, starting: 0, error: 0, unknown: 0 },
      openDelegationsCount: 1, finishedToday: 3, needsYouCount: 0,
      problems: { count: 52, items: [{ code: "delegationStalled", id: "ask-1", targetKind: "delegation" }, { code: "memberError", id: "m", targetKind: "agent" }, { code: "handlerOffline", id: "ask-gone", targetKind: "delegation" }, { code: "somethingNew", id: "x" }] },
      director: { sessionId: "d", goalAvailable: true, goal: { objective: "Ship r290", status: "active" }, plan: null },
      delegations: [{ askId: "ask-1", title: "Review", target: "m", quietSince: iso(MIN), progressNote: { text: "schema done", at: iso(MIN) }, steps: { done: 2, total: 4, currentStep: null, updatedAt: iso(MIN), source: "progressNote" }, stalled: true }],
      ...over,
    }],
  });
  const g1 = new Set([BOARD_SUMMARY_FEATURE, PROJECT_PLAN_FEATURE, ASK_STEPS_FEATURE]);
  const withSummary = (raw: unknown, members: [SessionResource, string][] = [[session("d"), "p"], [session("m", { displayName: "Mia" }), "p"]]) =>
    only(buildBoard([host("eva", [project("p", "P", "d")], members, { features: g1, summary: parseBoardSummary(raw)!, openAsks: null, closedAsks: null, notifications: null, approvals: null, services: null, quotaOut: null })], NOW));

  it("problem codes keep their jump target: delegation ids → the delegation, session ids → the agent", () => {
    const p = withSummary(summaryRaw());
    expect(p.problems).toEqual([
      { kind: "stalled", hostId: "eva", subject: "Review", detail: "Mia", target: { kind: "delegation", hostId: "eva", askId: "ask-1" } },
      { kind: "agentError", hostId: "eva", subject: "Mia", detail: null, target: { kind: "agent", hostId: "eva", sessionId: "m" } },
      // Not among the listed delegations: no title, still a jump to the delegation.
      { kind: "handlerOffline", hostId: "eva", subject: "", detail: null, target: { kind: "delegation", hostId: "eva", askId: "ask-gone" } },
      { kind: "other", hostId: "eva", subject: "", detail: "somethingNew", target: null },
    ]);
  });
  it("targetKind decides what an unknown code's id names; lastTurnFailed is soft (shown, not 出问题)", () => {
    const raw = summaryRaw({ problems: { count: 2, items: [{ code: "lastTurnFailed", id: "m", targetKind: "agent" }, { code: "futureThing", id: "ask-1", targetKind: "delegation" }] } });
    const p = withSummary(raw);
    expect(p.problems.map((x) => [x.kind, x.subject, x.target, x.soft ?? false])).toEqual([
      ["other", "Review", { kind: "delegation", hostId: "eva", askId: "ask-1" }, false],
      ["lastTurnFailed", "Mia", { kind: "agent", hostId: "eva", sessionId: "m" }, true],
    ]);
    const onlySoft = withSummary(summaryRaw({ problems: { count: 1, items: [{ code: "lastTurnFailed", id: "m", targetKind: "agent" }] } }));
    expect(onlySoft).toMatchObject({ problemCount: 1, hardProblems: 0, unsizedProblems: 0 });
    expect(healthOf(onlySoft, NOW)).toBe("ok");
  });
  it("needsYou {count, items} is read; goalAvailable false is unknown, not no goal; a long tool shows on its line", () => {
    const raw = summaryRaw({
      needsYouCount: 3, needsYou: { count: 3, items: [{ kind: "ask", id: "ask-1", agentId: "m" }] },
      problems: { count: 0, items: [] },
      director: { sessionId: "d", goalAvailable: false, goal: null, plan: null },
      delegations: [{ askId: "ask-2", title: "Build", target: "m", stalled: false, stallReason: "longToolCall", toolCallStartedAt: iso(20 * MIN), progressNote: null, steps: null }],
    });
    const p = withSummary(raw);
    expect(p.needsYou).toBe(3);
    expect(p).toMatchObject({ goal: null, goalUnknown: true });
    expect(p.problems).toEqual([]);
    expect(p.recent[0]).toMatchObject({ kind: "started", text: "Mia: Build", toolSince: iso(20 * MIN) });
    // Observed (goalAvailable true) with no goal: not unknown.
    expect(withSummary(summaryRaw({ director: { sessionId: "d", goalAvailable: true, goal: null, plan: null } })).goalUnknown).toBe(false);
  });
  it("problems.count is the exact total even when items are cut at the examples limit", () => {
    const p = withSummary(summaryRaw());
    expect(p.problemCount).toBe(52);
    expect(healthOf(p, NOW)).toBe("problem");
  });
  it("goal objective and the delegation's progressNote reach the card", () => {
    const sum = parseBoardSummary(summaryRaw())!.get("p")!;
    expect(sum.goal).toBe("Ship r290");
    expect(sum.delegations[0]).toMatchObject({ note: "schema done", at: iso(MIN), steps: { done: 2, total: 4 } });
    const p = withSummary(summaryRaw());
    expect(p.goal).toBe("Ship r290");
    expect(p.recent[0]!.text).toBe("Mia: schema done (2/4)");
  });
  it("declared-unavailable delegations / needs / today stay unknown: no zero, never 正常", () => {
    const raw = { availability: { members: true, delegations: false, needs: false, finishedToday: false }, projects: [{ projectId: "p", openDelegationsCount: null, needsYouCount: null, finishedToday: null, problems: { count: null, items: [] } }] };
    const p = withSummary(raw, [[session("m"), "p"]]);
    expect(p.counts.openDelegations).toBeNull();
    expect(p.needsYou).toBeNull();
    expect(p.today).toBeNull();
    expect(p.problemsUnknown).toBe(true);
    expect(healthOf(p, NOW)).toBe("unknown");
  });
  it("one unreadable place makes the merged number unknown, not the other host's count", () => {
    const a = host("eva", [project("p", "Same")], [[session("m"), "p"]], { openAsks: [ask("a1", "p", "m")] });
    const b = host("remote", [project("q", "Same")], [[session("n"), "q"]], { openAsks: null, services: null });
    const p = only(buildBoard([a, b], NOW));
    expect(p.counts.openDelegations).toBeNull();
    expect(p.needsYou).toBeNull();
    expect(healthOf(p, NOW)).toBe("unknown");
  });
  it("fallback lists that filled their page are partial: counts unknown, today unknown while the page is all today", () => {
    const start = localDayStart(NOW);
    const full = host("eva", [project("p", "P")], [[session("m"), "p"]], {
      openAsks: [ask("a1", "p", "m")], openAsksTruncated: true,
      closedAsks: [ask("c1", "p", "m", { closed: "accepted", closedAt: new Date(start + MIN).toISOString() })], closedAsksTruncated: true,
    });
    const p = only(buildBoard([full], NOW));
    expect(p.counts.openDelegations).toBeNull();
    expect(p.today).toBeNull();
    expect(healthOf(p, NOW)).toBe("unknown");
    // The page reaches back before today: today's count is complete.
    const older = only(buildBoard([{ ...full, openAsksTruncated: false, closedAsks: [...full.closedAsks!, ask("c0", "p", "m", { closed: "accepted", closedAt: new Date(start - MIN).toISOString() })] }], NOW));
    expect(older.today).toEqual({ done: 1, failed: 0 });
    expect(older.counts.openDelegations).toBe(1);
  });
  it("plan and goal belong to the 主管 shown: another host's 主管 plan is never borrowed", () => {
    const plain = (id: string, director: Record<string, unknown>) => parseBoardSummary({ projects: [{ projectId: id, openDelegationsCount: 0, needsYouCount: 0, finishedToday: 0, problems: { count: 0, items: [] }, director }] })!;
    const feat = new Set([BOARD_SUMMARY_FEATURE, PROJECT_PLAN_FEATURE]);
    const a = host("eva", [project("p", "Same", "alice")], [[session("alice"), "p"]], { features: feat, summary: plain("p", { sessionId: "alice", plan: null, goal: null }) });
    const b = host("remote", [project("q", "Same", "bob")], [[session("bob"), "q"]], { features: feat, summary: plain("q", { sessionId: "bob", plan: { done: 2, total: 4 }, goalAvailable: true, goal: { objective: "Bob's work" } }) });
    const ab = only(buildBoard([a, b], NOW));
    expect(ab.director?.sessionId).toBe("alice");
    expect(ab.plan).toBeNull();
    expect(ab.goal).toBeNull();
    const ba = only(buildBoard([b, a], NOW));
    expect(ba.director?.sessionId).toBe("bob");
    expect(ba).toMatchObject({ plan: { done: 2, total: 4 }, goal: "Bob's work" });
    // A summary naming another session as 主管 than the card's: not this 主管's plan.
    const other = host("eva", [project("p", "Same", "alice")], [[session("alice"), "p"]], { features: feat, summary: plain("p", { sessionId: "carol", plan: { done: 1, total: 2 } }) });
    expect(only(buildBoard([other], NOW)).plan).toBeNull();
  });
});

// Re-review P2 (board-p2-review S1/S2): these fail on d04013125.
describe("soft lastTurnFailed: member state and unlisted severity", () => {
  const g1 = new Set([BOARD_SUMMARY_FEATURE]);
  const soft = (n: number) => Array.from({ length: n }, (_, i) => ({ code: "lastTurnFailed", id: `m${i}`, targetKind: "agent" }));
  const board = (problems: Record<string, unknown>, members: [SessionResource, string][] = [[session("m0"), "p"]]) =>
    only(buildBoard([host("eva", [project("p", "P")], members, {
      features: g1, openAsks: null, closedAsks: null, notifications: null, approvals: null, services: null, quotaOut: null,
      summary: parseBoardSummary({ projects: [{ projectId: "p", openDelegationsCount: 0, finishedToday: 0, needsYou: { count: 0, items: [] }, problems, delegations: [] }] })!,
    })], NOW));

  it("an idle member whose previous turn failed stays idle (summary): no 出错 count, soft line only", () => {
    const m = session("m", { activityStatus: "idle", activity: { lastTurnError: { turnId: "old", message: "old failure" } } });
    const p = board({ count: 1, items: [{ code: "lastTurnFailed", id: "m", targetKind: "agent" }] }, [[m, "p"]]);
    expect(p.members[0]!.state).toBe("idle");
    expect(p.counts.error).toBe(0);
    expect(p.problems).toEqual([{ kind: "lastTurnFailed", hostId: "eva", subject: "m", detail: null, target: { kind: "agent", hostId: "eva", sessionId: "m" }, soft: true }]);
    expect(healthOf(p, NOW)).toBe("ok");
  });
  it("the same without a summary (older host): idle + a soft lastTurnFailed line; a runtime error is still 出错", () => {
    const h = host("eva", [project("p", "P")], [
      [session("old", { activity: { lastTurnError: { turnId: "t", message: "boom" } } }), "p"],
      [session("live", { runtime: { ...session("x").runtime, status: "error", lastError: { message: "crashed" } } }), "p"],
    ]);
    const p = only(buildBoard([h], NOW));
    expect(Object.fromEntries(p.members.map((m) => [m.sessionId, m.state]))).toEqual({ live: "error", old: "idle" });
    expect(p.problems.map((x) => [x.kind, x.subject, x.soft ?? false])).toEqual([["agentError", "live", false], ["lastTurnFailed", "old", true]]);
    expect(p.hardProblems).toBe(1);
  });
  it("21 soft problems with 20 listed: the unlisted one is of unknown severity — 情况不明, not 出问题", () => {
    const p = board({ count: 21, items: soft(20) });
    expect(p).toMatchObject({ problemCount: 21, hardProblems: 0, unsizedProblems: 1 });
    expect(healthOf(p, NOW)).toBe("unknown");
  });
  it("with per-code counts (problems.byCode) the unlisted split is exact", () => {
    const allSoft = board({ count: 21, items: soft(20), byCode: { lastTurnFailed: 21 } });
    expect(allSoft).toMatchObject({ problemCount: 21, hardProblems: 0, unsizedProblems: 0 });
    expect(healthOf(allSoft, NOW)).toBe("ok");
    const oneHard = board({ count: 21, items: soft(20), byCode: { lastTurnFailed: 20, delegationStalled: 1 } });
    expect(oneHard).toMatchObject({ problemCount: 21, hardProblems: 1, unsizedProblems: 0 });
    expect(healthOf(oneHard, NOW)).toBe("problem");
    // Malformed per-code counts are ignored: back to unknown severity.
    expect(board({ count: 21, items: soft(20), byCode: { lastTurnFailed: "x" } }).unsizedProblems).toBe(1);
  });
  it("a listed hard problem still makes it 出问题 whatever is unlisted", () => {
    const p = board({ count: 30, items: [{ code: "delegationStalled", id: "a1", targetKind: "delegation" }, ...soft(19)] });
    expect(p).toMatchObject({ problemCount: 30, hardProblems: 1, unsizedProblems: 10 });
    expect(healthOf(p, NOW)).toBe("problem");
  });
});

describe("order, health, prefs, targets", () => {
  const view = (key: string, name: string, last: number | null, over: Partial<BoardProjectView> = {}): BoardProjectView => ({
    key, name, color: "blue", places: [], director: null, members: [], counts: { busy: 0, idle: 1, paused: 0, error: 0, offline: 0, openDelegations: 0 },
    today: null, needsYou: 0, problems: [], problemCount: 0, hardProblems: 0, unsizedProblems: 0, problemsUnknown: false, recent: [], lastActivityAt: last, plan: null, goal: null, goalUnknown: false, ...over,
  });
  it("pinned first, then the owner's order, then the most recently active; hidden left out", () => {
    const list = [view("a", "A", 1), view("b", "B", 5), view("c", "C", 3), view("d", "D", 9)];
    expect(orderProjects(list, { pinned: ["c"], order: ["a"], hidden: ["d"] }).map((p) => p.key)).toEqual(["c", "a", "b"]);
  });
  it("quiet: nobody online and nothing for a day", () => {
    expect(healthOf(view("a", "A", NOW - 2 * 86_400_000, { counts: { busy: 0, idle: 0, paused: 0, error: 0, offline: 2, openDelegations: 0 } }), NOW)).toBe("quiet");
    expect(healthOf(view("a", "A", NOW - 2 * 86_400_000), NOW)).toBe("ok");
  });
  it("prefs: defaults, sanitising, and what the window may change", () => {
    expect(parseBoardPrefs(null)).toEqual(DEFAULT_BOARD_PREFS);
    const p = parseBoardPrefs({ openOnLaunch: true, view: "thumbnail", pinned: ["a", "a", 3], bounds: { x: 10, y: 20, width: 900, height: 1600 } });
    expect(p).toMatchObject({ openOnLaunch: true, view: "thumbnail", pinned: ["a"], bounds: { x: 10, y: 20, width: 900, height: 1600 } });
    expect(parseBoardPrefs({ bounds: { x: 0, y: 0, width: 10, height: 10 }, view: "columns" })).toMatchObject({ bounds: null, view: "cards" });
    const next = applyBoardPatch(p, { bigText: true, alwaysOnTop: "yes", bounds: { x: 1, y: 1, width: 999, height: 999 }, hidden: ["z"] });
    expect(next).toMatchObject({ bigText: true, alwaysOnTop: false, bounds: p.bounds, hidden: ["z"] });
  });
  it("targets from the window are checked", () => {
    expect(parseBoardTarget({ kind: "agent", hostId: "eva", sessionId: "s" })).toEqual({ kind: "agent", hostId: "eva", sessionId: "s" });
    expect(parseBoardTarget({ kind: "project", hostId: "eva" })).toBeNull();
    expect(parseBoardTarget({ kind: "shell", cmd: "rm" })).toBeNull();
    expect(parseBoardTarget({ kind: "needsYou" })).toEqual({ kind: "needsYou" });
  });
});

describe("dev demo", () => {
  it("builds through the model: six projects, Waveline joined across both hosts", () => {
    const list = demoBoardProjects(NOW);
    expect(list.map((p) => p.name).sort()).toEqual(["cutex 后端", "cutex-desktop", "demo-study", "ifm-ema", "STORM II 美术", "Waveline"].sort());
    expect(list.find((p) => p.name === "Waveline")!.places.map((x) => x.hostId)).toEqual(["demo-eva", "demo-remote"]);
    expect(list.find((p) => p.name === "cutex 后端")!.problems.map((x) => x.kind).sort()).toEqual(["agentError", "quotaOut"]);
  });
});
