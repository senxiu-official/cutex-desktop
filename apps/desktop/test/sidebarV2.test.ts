import { describe, expect, it } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { ApprovalRecord, AskSummary } from "../src/shared/ipc";
import { agentSignal, attentionChips, formatElapsed, needsYouByAgent, runningSince, wantsOwner, type AgentSignal } from "../src/renderer/src/lib/agentAttention";
import { applyTurnEnd, applyTurnStart, clearMark, pruneMarks, settleStartedTurns, turnEndOf, turnStartOf, type RunningTurn, type TurnMarks } from "../src/renderer/src/lib/turnUnread";
import { layoutSidebar, showsPreview, type LayoutPrefs } from "../src/renderer/src/lib/sidebarLayout";
import type { AgentRow, AgentStatus, ProjectGroup, SidebarGroup } from "../src/renderer/src/lib/sidebar";

function row(id: string, status: AgentStatus = "idle", over: { director?: boolean; observedAt?: string | null; last?: number } = {}): AgentRow {
  const session = { cutexSessionId: id, displayName: id, runtime: { activeTurnObservedAt: over.observedAt ?? null } } as unknown as SessionResource;
  return { id, name: id, subtitle: "", status, isDirector: over.director ?? false, pinned: false, lastActivity: over.last ?? 0, profile: null, color: null, session };
}

function project(id: string, rows: AgentRow[]): ProjectGroup {
  return { kind: "project", id, name: id, badge: "", color: "blue", online: rows.filter((r) => r.status !== "offline"), offline: rows.filter((r) => r.status === "offline") };
}

const ask = (askId: string, target: string, over: Partial<AskSummary>): AskSummary =>
  ({ askId, title: askId, requester: { kind: "owner" }, target, execution: "running", attempts: 1, createdAt: "2026-10-08T00:00:00Z", updatedAt: "2026-10-08T00:00:00Z", revision: 1, ...over }) as AskSummary;

describe("turn marks", () => {
  it("reads turn/completed params", () => {
    expect(turnEndOf("turn/completed", { turn: { id: "t1", status: "failed" } })).toEqual({ turnId: "t1", status: "failed" });
    expect(turnEndOf("turn/started", { turn: { id: "t1" } })).toBeNull();
    expect(turnEndOf("turn/completed", {})).toEqual({ turnId: null, status: "completed" });
  });

  it("marks unseen turns, skips seen and interrupted ones", () => {
    let marks: TurnMarks = {};
    marks = applyTurnEnd(marks, "a", { turnId: "t1", status: "completed" }, 10, false);
    expect(marks.a).toEqual({ at: 10, failed: false, turnId: "t1", count: 1 });
    marks = applyTurnEnd(marks, "b", { turnId: "t2", status: "failed" }, 11, false);
    expect(marks.b?.failed).toBe(true);
    const same = applyTurnEnd(marks, "c", { turnId: "t3", status: "interrupted" }, 12, false);
    expect(same).toBe(marks);
    marks = applyTurnEnd(marks, "a", { turnId: "t4", status: "completed" }, 13, true);
    expect(marks.a).toBeUndefined();
  });

  it("failed, then a later turn started: no longer red, its unseen count stays; failed again: red again", () => {
    expect(turnStartOf("turn/started", { turn: { id: "t2" } })).toBe("t2");
    expect(turnStartOf("turn/started", {})).toBe("");
    expect(turnStartOf("turn/completed", { turn: { id: "t2" } })).toBeNull();
    let marks: TurnMarks = applyTurnEnd({}, "a", { turnId: "t1", status: "failed" }, 10, false);
    expect(agentSignal(row("a"), undefined, marks.a)).toBe("error");
    expect(applyTurnStart(marks, "a", "t1")).toBe(marks); // the failed turn's own (late) start
    expect(applyTurnStart(marks, "b", "t9")).toBe(marks);
    marks = applyTurnStart(marks, "a", "t2");
    expect(marks.a).toEqual({ at: 10, failed: false, turnId: "t1", count: 1 });
    expect(agentSignal(row("a"), undefined, marks.a)).toBe("done");
    expect(applyTurnStart(marks, "a", "t3")).toBe(marks); // nothing red left: unchanged
    marks = applyTurnEnd(marks, "a", { turnId: "t2", status: "failed" }, 20, false);
    expect(marks.a).toEqual({ at: 20, failed: true, turnId: "t2", count: 2 });
    expect(agentSignal(row("a"), undefined, marks.a)).toBe("error");
    // A runtime in error stays marked whatever the turn marks say.
    expect(agentSignal(row("a", "error"), undefined, applyTurnStart(marks, "a", "t3").a)).toBe("error");
  });

  it("failed then opened clears the mark; a failed mark restored after a restart settles once a later turn runs", () => {
    const failed: TurnMarks = applyTurnEnd({}, "a", { turnId: "t1", status: "failed" }, Date.parse("2026-11-05T10:00:00Z"), false);
    expect(clearMark(failed, "a").a).toBeUndefined();
    const run = (activeTurnId: string | null, at: string | null): RunningTurn => ({ cutexSessionId: "a", runtime: { activeTurnId, activeTurnObservedAt: at } });
    expect(settleStartedTurns(failed, [run("t2", "2026-11-05T10:05:00Z")]).a).toMatchObject({ failed: false, count: 1 });
    // Not running, the failed turn itself, a snapshot older than the failure, no start time: unchanged.
    for (const s of [run(null, null), run("t1", "2026-11-05T10:05:00Z"), run("t0", "2026-11-05T09:59:00Z"), run("t2", null)]) expect(settleStartedTurns(failed, [s])).toBe(failed);
    const unknown: TurnMarks = { a: { at: 1, failed: true, turnId: null } };
    expect(settleStartedTurns(unknown, [run("t2", "2026-11-05T10:05:00Z")])).toBe(unknown);
  });

  it("clears and prunes", () => {
    const marks: TurnMarks = { a: { at: 1, failed: false, turnId: null }, b: { at: 2, failed: true, turnId: null } };
    expect(clearMark(marks, "zzz")).toBe(marks);
    expect(Object.keys(clearMark(marks, "a"))).toEqual(["b"]);
    expect(Object.keys(pruneMarks(marks, new Set(["b"])))).toEqual(["b"]);
    expect(pruneMarks(marks, new Set(["a", "b"]))).toBe(marks);
  });
});

describe("needs-you and signals", () => {
  it("collects reasons per agent", () => {
    const approvals = [{ approvalId: "x", requesterCutexSessionId: "m", state: "pending" } as ApprovalRecord, { approvalId: "y", requesterCutexSessionId: "m", state: "approved" } as ApprovalRecord];
    const delegations = [
      ask("q", "m", { ownerQuestions: 1 }),
      ask("acc", "e", { execution: "answered", review: "awaitingAcceptance" }),
      ask("agentAcc", "e", { execution: "answered", review: "awaitingAcceptance", requester: { kind: "agent", cutexSessionId: "lead" } as AskSummary["requester"] }),
      ask("rev", "r", { execution: "pendingReview" }),
    ];
    const needs = needsYouByAgent({ pending: { p: ["item/commandExecution/requestApproval", "item/tool/requestUserInput"] }, approvals, delegations });
    expect(needs.get("p")).toEqual({ count: 2, reasons: ["confirm", "question"], askIds: [] });
    expect(needs.get("m")).toEqual({ count: 2, reasons: ["approval", "question"], askIds: ["q"] });
    expect(needs.get("e")).toEqual({ count: 1, reasons: ["acceptance"], askIds: ["acc"] });
    expect(needs.get("r")?.reasons).toEqual(["review"]);
  });

  it("picks the most urgent signal", () => {
    const mark = { at: 1, failed: false, turnId: null };
    expect(agentSignal(row("a", "running"), { count: 1, reasons: ["approval"], askIds: [] }, undefined)).toBe("needsYou");
    expect(agentSignal(row("a", "needsInput"), undefined, undefined)).toBe("needsYou");
    expect(agentSignal(row("a", "running"), undefined, mark)).toBe("running");
    expect(agentSignal(row("a", "idle"), undefined, { ...mark, failed: true })).toBe("error");
    expect(agentSignal(row("a", "error"), undefined, undefined)).toBe("error");
    expect(agentSignal(row("a", "idle"), undefined, mark)).toBe("done");
    expect(agentSignal(row("a", "offline"), undefined, mark)).toBe("done");
    expect(agentSignal(row("a", "offline"), undefined, undefined)).toBe("offline");
    expect(agentSignal(row("a", "idle"), undefined, undefined)).toBe("idle");
    expect(wantsOwner("running")).toBe(false);
  });

  it("orders strip chips and leaves out the open agent", () => {
    const rows = [row("done1"), row("err"), row("need"), row("open"), row("idle"), row("done2")];
    const signals = new Map<string, AgentSignal>([["done1", "done"], ["err", "error"], ["need", "needsYou"], ["open", "needsYou"], ["idle", "idle"], ["done2", "done"]]);
    const needs = new Map([["need", { count: 1, reasons: ["acceptance" as const], askIds: ["a1"] }]]);
    const marks: TurnMarks = { done1: { at: 1, failed: false, turnId: null }, done2: { at: 5, failed: false, turnId: null } };
    const chips = attentionChips(rows, signals, needs, marks, "open");
    expect(chips.map((c) => c.id)).toEqual(["need", "err", "done2", "done1"]);
    expect(chips[0]).toMatchObject({ reason: "acceptance", askId: "a1", count: 1 });
  });

  it("formats elapsed time and reads the turn start", () => {
    expect(formatElapsed(8_400)).toBe("8s");
    expect(formatElapsed(4 * 60_000)).toBe("4m");
    expect(formatElapsed(65 * 60_000)).toBe("1h05");
    expect(formatElapsed(3 * 86_400_000)).toBe("3d");
    expect(runningSince(row("a", "running", { observedAt: "2026-10-08T00:00:00Z" }))).toBe(Date.parse("2026-10-08T00:00:00Z"));
    expect(runningSince(row("a", "running"))).toBeNull();
  });
});

describe("sidebar layout", () => {
  const prefs: LayoutPrefs = { grouping: "all", noOnline: "collapse", running: "avatars" };
  const signals = new Map<string, AgentSignal>([["run", "running"], ["done", "done"], ["need", "needsYou"], ["off", "offline"], ["idle", "idle"], ["dir", "idle"], ["sel", "idle"], ["offDone", "done"]]);
  const ctx = (over: Partial<Parameters<typeof layoutSidebar>[1]> = {}) => ({ signalOf: (id: string) => signals.get(id), selectedId: "sel", starred: new Set<string>(), prefs, ...over });
  const busy = project("busy", [row("dir", "idle", { director: true }), row("run", "running"), row("done"), row("need", "needsInput"), row("idle"), row("sel"), row("off", "offline"), row("offDone", "offline")]);
  const quiet = project("quiet", [row("q1", "offline", { last: 50 }), row("q2", "offline", { last: 70 })]);

  it("splits a project's agents into listed (big / running / recent) and the two folds", () => {
    const [l] = layoutSidebar([busy], ctx()).main;
    expect(l!.mode).toBe("full");
    expect(l!.big.map((r) => r.id)).toEqual(["dir", "need"]);
    expect(l!.running.map((r) => r.id)).toEqual(["run"]);
    // A finished turn not seen yet is 最近, online or offline; no clock: nothing else is recent by time.
    expect(l!.recent.map((r) => r.id).sort()).toEqual(["done", "offDone"]);
    expect(l!.idle.map((r) => r.id)).toEqual(["idle", "sel"]);
    expect(l!.offline.map((r) => r.id)).toEqual(["off"]);
    expect(l).toMatchObject({ runningCount: 1, needsYouCount: 1, attentionCount: 3, onlineCount: 6, hasSelected: true });
  });

  it("opening an agent never moves it", () => {
    const [none] = layoutSidebar([busy], ctx({ selectedId: null })).main;
    for (const id of ["run", "off", "idle", "done"]) {
      const [l] = layoutSidebar([busy], ctx({ selectedId: id })).main;
      for (const k of ["big", "running", "recent", "idle", "offline"] as const) expect(l![k].map((r) => r.id)).toEqual(none![k].map((r) => r.id));
    }
  });

  it("a fresh agent (lib/freshAgents) is listed with the recent ones, never folded", () => {
    const [l] = layoutSidebar([busy], ctx({ isFresh: (key: string) => key === "idle" || key === "off" })).main;
    expect(l!.recent.map((r) => r.id)).toEqual(expect.arrayContaining(["idle", "off"]));
    expect(l!.idle.map((r) => r.id)).toEqual(["sel"]);
    expect(l!.offline).toEqual([]);
  });

  it("运行中智能体 = 完整显示 draws running agents as big rows", () => {
    const [l] = layoutSidebar([busy], ctx({ prefs: { ...prefs, running: "full" } })).main;
    expect(l!.running).toEqual([]);
    expect(l!.big.map((r) => r.id)).toContain("run");
  });

  it("collapses projects without online agents in 全部分组 unless set to expand / starred", () => {
    const l = layoutSidebar([busy, quiet], ctx());
    expect(l.main.map((g) => [g.group.id, g.mode])).toEqual([["busy", "full"], ["quiet", "collapsed"]]);
    expect(l.main[1]!.lastActivity).toBe(70);
    expect(layoutSidebar([busy, quiet], ctx({ prefs: { ...prefs, noOnline: "expand" } })).main[1]!.mode).toBe("full");
    const starred = layoutSidebar([busy, quiet], ctx({ starred: new Set(["quiet"]) }));
    expect(starred.main.map((g) => [g.group.id, g.mode, g.starred])).toEqual([["quiet", "full", true], ["busy", "full", false]]);
  });

  it("keeps a quiet project open when it holds the open agent", () => {
    expect(layoutSidebar([quiet], ctx({ selectedId: "q1" })).main[0]!.mode).toBe("full");
  });

  it("星标展开 puts unstarred projects under 其他项目", () => {
    const l = layoutSidebar([busy, quiet] as SidebarGroup[], ctx({ prefs: { ...prefs, grouping: "starred" }, starred: new Set(["quiet"]) }));
    expect(l.main.map((g) => g.group.id)).toEqual(["quiet"]);
    expect(l.others.map((g) => [g.group.id, g.mode])).toEqual([["busy", "collapsed"]]);
  });

  it("searching shows every match in full", () => {
    const l = layoutSidebar([busy, quiet], ctx({ searching: true, prefs: { ...prefs, grouping: "starred" } }));
    expect(l.others).toEqual([]);
    expect(l.main.every((g) => g.mode === "full" && g.running.length === 0 && g.idle.length === 0 && g.offline.length === 0)).toBe(true);
  });

  it("latest-message line per setting", () => {
    expect(showsPreview({ isDirector: true }, "director")).toBe(true);
    expect(showsPreview({ isDirector: false }, "director")).toBe(false);
    expect(showsPreview({ isDirector: false }, "all")).toBe(true);
    expect(showsPreview({ isDirector: true }, "off")).toBe(false);
  });
});
