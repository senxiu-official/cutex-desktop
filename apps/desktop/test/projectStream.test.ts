// Project 「动态」 model (modules/project-view/stream.ts, design 022): type chips → `kinds=`, 只看需要你,
// merging live rows, day groups, row words / click targets, and 正在进行 (summary, open-by-default, stop requests).
import { describe, expect, it } from "vitest";
import type { BackgroundItem, ProjectBackground, ProjectEvent } from "../src/shared/projectEvents";
import {
  attentionRows,
  dayOf,
  describeRow,
  feedKey,
  formatDuration,
  groupByDay,
  groupOf,
  mergeRows,
  newerThan,
  queryKinds,
  rowTarget,
  runningOpen,
  runningSummary,
  stopCall,
  toggleGroup,
} from "../src/renderer/src/modules/project-view/stream";

const ev = (seq: number, kind: string, extra: Partial<ProjectEvent> = {}): ProjectEvent => ({
  cursor: `pe:${seq}`,
  at: "2026-10-23T03:00:00.000Z",
  projectId: "p1",
  cutexSessionId: "cutex.a",
  agentName: "a",
  kind,
  status: null,
  title: "T",
  detail: null,
  parent: { turnId: null, taskId: null, threadId: null },
  refs: { askId: null, jobId: null, artifactId: null, workflowRunId: null, approvalId: null, notificationId: null },
  source: { method: null, eventCursor: null },
  ...extra,
});

const item = (over: Partial<BackgroundItem> = {}): BackgroundItem => ({
  kind: "subagent",
  source: "claude",
  id: "t1",
  title: "Review",
  detail: null,
  turnId: null,
  threadId: "th",
  startedAt: "2026-10-23T03:00:00.000Z",
  state: "running",
  stop: { kind: "native", cutexSessionId: "cutex.a", method: "claude/tasks/stop", params: { threadId: "th", taskId: "t1" } },
  ...over,
});

describe("type chips and kinds=", () => {
  it("maps kinds to chips; unknown kinds are 「其它」", () => {
    expect(groupOf("turn.failed")).toBe("turn");
    expect(groupOf("ownerNotify.created")).toBe("other");
    expect(groupOf("journal.gap")).toBe("other");
    expect(groupOf("future.kind")).toBe("other");
  });

  it("no chip / every chip = no kinds parameter; chips in a stable order; 只看需要你 reads the attention kinds", () => {
    expect(queryKinds([], false)).toBeUndefined();
    expect(queryKinds(["turn", "ask", "subagent", "background", "approval", "artifact", "other"], false)).toBeUndefined();
    expect(queryKinds(["other", "turn"], false)).toEqual(["turn", "workflow", "ownerNotify", "job", "runtime", "member", "journal"]);
    expect(queryKinds(["artifact"], true)).toEqual(["turn", "ask", "background", "approval", "ownerNotify"]);
    expect(toggleGroup(["ask"], "turn")).toEqual(["turn", "ask"]);
    expect(toggleGroup(["turn", "ask"], "turn")).toEqual(["ask"]);
  });

  it("one feed per host + project + filter", () => {
    expect(feedKey("h", "p", undefined, null)).not.toBe(feedKey("h", "p", ["turn"], null));
    expect(feedKey("h", "p", ["turn"], "cutex.a")).not.toBe(feedKey("h", "p", ["turn"], null));
  });
});

describe("只看需要你", () => {
  it("keeps pending approvals, failures and owner messages", () => {
    const rows = [
      ev(9, "approval.decided", { status: "approved", refs: { ...ev(0, "x").refs, approvalId: "ap1" } }),
      ev(8, "approval.requested", { refs: { ...ev(0, "x").refs, approvalId: "ap1" } }),
      ev(7, "approval.requested", { refs: { ...ev(0, "x").refs, approvalId: "ap2" } }),
      ev(6, "turn.failed"),
      ev(5, "turn.completed"),
      ev(4, "ask.failed"),
      ev(3, "background.finished", { status: "failed" }),
      ev(2, "background.finished", { status: "stopped" }),
      ev(1, "ownerNotify.created"),
    ];
    expect(attentionRows(rows).map((r) => r.cursor)).toEqual(["pe:7", "pe:6", "pe:4", "pe:3", "pe:1"]);
  });
});

describe("pages and live rows", () => {
  it("merges newest first, once per cursor", () => {
    const page = [ev(10, "turn.completed"), ev(8, "turn.completed")];
    const merged = mergeRows(page, [ev(11, "ask.created"), ev(10, "turn.completed", { title: "again" }), ev(9, "x.y")]);
    expect(merged.map((r) => r.cursor)).toEqual(["pe:11", "pe:10", "pe:9", "pe:8"]);
    expect(merged[1]!.title).toBe("again");
    expect(mergeRows(page, [])).toBe(page);
  });

  it("counts rows newer than the last one seen at the top", () => {
    const rows = [ev(12, "a.b"), ev(11, "a.b"), ev(10, "a.b")];
    expect(newerThan(rows, 10)).toBe(2);
    expect(newerThan(rows, 12)).toBe(0);
  });

  it("groups by local day: today, yesterday, then dates", () => {
    const now = new Date(2026, 9, 23, 10, 0).getTime();
    const at = (d: number, h: number) => new Date(2026, 9, d, h, 30).toISOString();
    expect(dayOf(at(23, 1), now)).toBe("today");
    expect(dayOf(at(22, 23), now)).toBe("yesterday");
    expect(dayOf(at(20, 12), now)).toBe("2026-10-20");
    const groups = groupByDay([ev(3, "a.b", { at: at(23, 9) }), ev(2, "a.b", { at: at(23, 1) }), ev(1, "a.b", { at: at(21, 5) })], now);
    expect(groups.map((g) => [g.day, g.rows.length])).toEqual([["today", 2], ["2026-10-21", 1]]);
  });
});

describe("one row", () => {
  it("words and tones per kind", () => {
    expect(describeRow(ev(1, "turn.completed", { durationMs: 42_500, toolCalls: 7 }))).toMatchObject({ text: "turn", tone: "default", durationMs: 42_500, toolCalls: 7 });
    expect(describeRow(ev(1, "turn.failed"))).toMatchObject({ text: "turnFailed", tone: "danger", badge: "fail" });
    expect(describeRow(ev(1, "background.finished", { status: "killed" }))).toMatchObject({ text: "backgroundFailed", mono: true, tone: "danger" });
    expect(describeRow(ev(1, "background.finished", { status: "stopped" }))).toMatchObject({ text: "backgroundStopped", tone: "muted" });
    expect(describeRow(ev(1, "background.finished", { status: "completed" }))).toMatchObject({ text: "backgroundFinished", badge: "ok" });
    expect(describeRow(ev(1, "approval.decided", { status: "denied" }))).toMatchObject({ text: "approvalDenied", badge: "fail" });
    expect(describeRow(ev(1, "subagent.finished", { status: "interrupted" }))).toMatchObject({ text: "subagentInterrupted" });
    expect(describeRow(ev(1, "brand.new"))).toMatchObject({ text: "other", group: "other" });
  });

  it("click targets: the turn, the delegation, the artifact, the approvals page, else the agent", () => {
    expect(rowTarget(ev(1, "turn.completed", { parent: { turnId: "t9", taskId: null, threadId: "th" } }))).toEqual({ kind: "turn", sessionId: "cutex.a", turnId: "t9", threadId: "th", agentName: "a", snippet: "T" });
    expect(rowTarget(ev(1, "ask.answered", { refs: { ...ev(0, "x").refs, askId: "ask-1" } }))).toEqual({ kind: "delegation", askId: "ask-1", title: "T" });
    expect(rowTarget(ev(1, "artifact.published", { refs: { ...ev(0, "x").refs, artifactId: "art" } }))).toEqual({ kind: "artifact", ref: "art@latest", name: "T" });
    expect(rowTarget(ev(1, "approval.requested", { refs: { ...ev(0, "x").refs, approvalId: "ap" } }))).toEqual({ kind: "approvals" });
    expect(rowTarget(ev(1, "background.finished"))).toEqual({ kind: "agent", sessionId: "cutex.a" });
    expect(rowTarget(ev(1, "journal.gap", { cutexSessionId: null }))).toBeNull();
    expect(rowTarget(ev(1, "member.joined", { cutexSessionId: null }))).toBeNull();
  });

  it("durations", () => {
    expect(formatDuration(42_500)).toBe("43s");
    expect(formatDuration(400_000)).toBe("6m 40s");
    expect(formatDuration(120_000)).toBe("2m");
    expect(formatDuration(5_400_000)).toBe("1h 30m");
  });
});

describe("正在进行", () => {
  const bg = (agents: ProjectBackground["agents"]): ProjectBackground => ({ projectId: "p1", generatedAt: "", jobsAvailable: true, agents });

  it("counts by kind, drops idle agents (not incomplete ones), puts sub-agents first", () => {
    const s = runningSummary(
      bg([
        { cutexSessionId: "a", agentName: "A", backend: "claude", runtime: "online", complete: true, items: [item({ kind: "background", id: "b1" }), item({ id: "s1" })] },
        { cutexSessionId: "b", agentName: "B", backend: "codex", runtime: "online", complete: true, items: [] },
        { cutexSessionId: "c", agentName: "C", backend: "codex", runtime: "offline", complete: false, items: [] },
        { cutexSessionId: "d", agentName: "D", backend: "claude", runtime: "online", complete: true, items: [item({ kind: "job", source: "job", id: "j1" }), item({ kind: "task", id: "k1" })] },
      ]),
    );
    expect(s.total).toBe(4);
    expect(s.byKind).toEqual({ subagent: 1, background: 2, job: 1 });
    expect(s.agents.map((a) => a.cutexSessionId)).toEqual(["a", "d", "c"]);
    expect(s.agents[0]!.items.map((i) => i.id)).toEqual(["s1", "b1"]);
    expect(runningSummary(null).total).toBe(0);
  });

  it("open by default with three or fewer; the owner's toggle wins", () => {
    expect(runningOpen(null, 3)).toBe(true);
    expect(runningOpen(null, 4)).toBe(false);
    expect(runningOpen(true, 9)).toBe(true);
    expect(runningOpen(false, 1)).toBe(false);
  });

  it("stop requests: only the contract's methods; none for unknown items or without stop", () => {
    expect(stopCall(item())).toEqual({ kind: "claudeTask", sessionId: "cutex.a", threadId: "th", taskId: "t1" });
    expect(stopCall(item({ stop: { kind: "native", cutexSessionId: "cutex.b", method: "thread/backgroundTerminals/terminate", params: { threadId: "th", processId: 42 } } }))).toEqual({ kind: "terminal", sessionId: "cutex.b", threadId: "th", processId: "42" });
    expect(stopCall(item({ stop: { kind: "job", jobId: "j", expectedRevision: 3 } }))).toEqual({ kind: "job", jobId: "j", expectedRevision: 3 });
    expect(stopCall(item({ state: "unknown" }))).toBeNull();
    expect(stopCall(item({ stop: null }))).toBeNull();
    expect(stopCall(item({ stop: { kind: "native", cutexSessionId: "x", method: "thread/shell/run" as never, params: {} } }))).toBeNull();
    expect(stopCall(item({ stop: { kind: "native", cutexSessionId: "x", method: "claude/tasks/stop", params: { threadId: "th" } } }))).toBeNull();
  });
});
