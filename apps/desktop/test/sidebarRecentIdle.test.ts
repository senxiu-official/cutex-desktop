// Sidebar idle fold by recency (2026-10-18): an online idle agent folds into 「N 个空闲」 only once its
// last conversation activity is IDLE_FOLD_AFTER_MS old; the activity time ignores runtime lifecycle
// and session metadata (cutex activity.lastConversationAt, never runtime.lastEventAt / updatedAt).
import { describe, expect, it } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { AgentSignal } from "../src/renderer/src/lib/agentAttention";
import { foldLabel, IDLE_FOLD_AFTER_MS, layoutGroup, nextIdleFold, type LayoutPrefs } from "../src/renderer/src/lib/sidebarLayout";
import { buildSidebar, conversationActivity, type AgentRow, type AgentStatus, type ProjectGroup } from "../src/renderer/src/lib/sidebar";
import type { SidebarSnapshot } from "../src/shared/ipc";

const MIN = 60_000;
const NOW = Date.parse("2026-10-18T12:00:00Z");

function row(id: string, status: AgentStatus, last: number, over: { director?: boolean; pinned?: boolean } = {}): AgentRow {
  const session = {
    cutexSessionId: id,
    displayName: id,
    lifecycle: "active",
    createdAt: null,
    runtime: { status: status === "offline" ? "offline" : "online", activeTurnId: status === "running" ? "t1" : null, activeTurnObservedAt: null },
  } as unknown as SessionResource;
  return { id, name: id, subtitle: "", status, isDirector: over.director ?? false, pinned: over.pinned ?? false, lastActivity: last, profile: null, color: null, session };
}

function project(rows: AgentRow[]): ProjectGroup {
  return { kind: "project", id: "p", name: "p", badge: "", color: "blue", online: rows.filter((r) => r.status !== "offline"), offline: rows.filter((r) => r.status === "offline") };
}

const prefs: LayoutPrefs = { grouping: "all", noOnline: "collapse", running: "avatars", foldIdle: true };
const ctx = (now: number | undefined, signals: Record<string, AgentSignal> = {}, over: Record<string, unknown> = {}) => ({ signalOf: (id: string) => signals[id], selectedId: null, starred: new Set<string>(), prefs, now, ...over });
const ids = (rows: readonly AgentRow[]) => rows.map((r) => r.id);

describe("idle fold threshold", () => {
  const group = project([row("recent", "idle", NOW - 5 * MIN), row("old", "idle", NOW - 120 * MIN), row("run", "running", NOW - 200 * MIN), row("off", "offline", NOW - MIN)]);

  it("an agent idle for 5 minutes stays a full row, one idle for 2 hours folds", () => {
    const l = layoutGroup(group, ctx(NOW), false);
    expect(ids(l.full)).toEqual(["recent"]);
    expect(ids(l.idle)).toEqual(["old"]);
    expect(ids(l.running)).toEqual(["run"]);
    expect(ids(l.offline)).toEqual(["off"]);
    expect(foldLabel(l.idle.length, l.idleDone.length)).toEqual({ idle: 1, done: 0 });
  });

  it("the row moves into the fold when the clock crosses the threshold", () => {
    const crossing = NOW - 5 * MIN + IDLE_FOLD_AFTER_MS;
    expect(nextIdleFold([group], NOW)).toBe(crossing);
    expect(ids(layoutGroup(group, ctx(crossing - 1), false).full)).toEqual(["recent"]);
    const after = layoutGroup(group, ctx(crossing), false);
    expect(ids(after.full)).toEqual([]);
    expect(ids(after.idle)).toEqual(["recent", "old"]);
    // Nothing crosses after that except the running row's (harmless) own time: none left.
    expect(nextIdleFold([group], crossing)).toBeNull();
  });

  it("the live activity preview (lastOf) counts as activity", () => {
    const l = layoutGroup(group, ctx(NOW, {}, { lastOf: (r: AgentRow) => (r.id === "old" ? NOW - MIN : r.lastActivity) }), false);
    expect(ids(l.full)).toEqual(["old", "recent"]);
  });

  it("a recent finished turn not seen yet is a full row; an old one stays folded with 「· N 完成」", () => {
    const g = project([row("recentDone", "idle", NOW - 2 * MIN), row("oldDone", "idle", NOW - 90 * MIN)]);
    const l = layoutGroup(g, ctx(NOW, { recentDone: "done", oldDone: "done" }), false);
    expect(ids(l.full)).toEqual(["recentDone"]);
    expect(ids(l.idle)).toEqual(["oldDone"]);
    expect(l.idleDone).toEqual(["oldDone"]);
    expect(foldLabel(l.idle.length, l.idleDone.length)).toEqual({ idle: 0, done: 1 });
  });

  it("keeps the other rules: Director and pins full, the open long-idle agent stays in the fold", () => {
    const g = project([row("dir", "idle", NOW - 300 * MIN, { director: true }), row("pin", "idle", NOW - 300 * MIN, { pinned: true }), row("sel", "idle", NOW - 300 * MIN), row("new", "idle", NOW - MIN)]);
    const l = layoutGroup(g, ctx(NOW, {}, { selectedId: "sel" }), false);
    expect(ids(l.full)).toEqual(["dir", "pin", "new"]);
    expect(ids(l.idle)).toEqual(["sel"]);
    expect(l.idleSelected).toBe("sel");
    const open = layoutGroup(g, ctx(NOW, {}, { selectedId: "new" }), false);
    expect(ids(open.full)).toEqual(["dir", "pin", "new"]);
    expect(open.idleSelected).toBeNull();
  });

  it("without a clock every online idle agent folds (no recency rule); 不收起 lists them all", () => {
    expect(ids(layoutGroup(group, ctx(undefined), false).idle)).toEqual(["recent", "old"]);
    expect(ids(layoutGroup(group, ctx(NOW, {}, { prefs: { ...prefs, foldIdle: false } }), false).full)).toEqual(["old", "recent"]);
  });
});

describe("conversation activity time", () => {
  const base = { createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-18T11:59:00Z", runtime: { lastEventAt: "2026-10-18T11:59:30Z" } };
  const session = (activity: Record<string, unknown> | null) => ({ ...base, activity }) as unknown as SessionResource;

  it("uses cutex lastConversationAt, never the runtime's last event or updatedAt", () => {
    expect(conversationActivity(session({ lastConversationAt: "2026-10-18T10:00:00Z", lastTurnCompletedAt: "2026-10-18T11:00:00Z" }))).toBe(Date.parse("2026-10-18T10:00:00Z"));
  });

  it("older cutex: the newest turn / item time of the activity projection", () => {
    const at = conversationActivity(session({ lastOutputAt: "2026-10-18T09:00:00Z", lastTurnCompletedAt: "2026-10-18T09:00:05Z", lastToolCall: { updatedAt: "2026-10-18T08:00:00Z" } }));
    expect(at).toBe(Date.parse("2026-10-18T09:00:05Z"));
  });

  it("no activity yet: the creation time", () => {
    expect(conversationActivity(session(null))).toBe(Date.parse("2026-10-01T00:00:00Z"));
    expect(conversationActivity(session({ lastConversationAt: null, lastOutputAt: null }))).toBe(Date.parse("2026-10-01T00:00:00Z"));
  });
});

// r244 acceptance (2026-10-18): 「似乎也没有」 folding, and whether a runtime restart reorders the sidebar.
describe("r244 acceptance: brand-new agents, runtime restarts", () => {
  const iso = (ms: number) => new Date(ms).toISOString();
  const agent = (id: string, over: { created: number; conversation: number | null; generation?: number; lastEventAt?: number; updatedAt?: number }) => ({
    cutexSessionId: id,
    displayName: id,
    lifecycle: "active",
    createdAt: iso(over.created),
    updatedAt: iso(over.updatedAt ?? over.created),
    runtime: { status: "online", runtimeGeneration: over.generation ?? 1, activeTurnId: null, activeTurnObservedAt: null, lastEventAt: iso(over.lastEventAt ?? over.created) },
    activity: { lastConversationAt: over.conversation === null ? null : iso(over.conversation) },
  }) as unknown as SessionResource;
  const snapshot = (active: SessionResource[]): SidebarSnapshot => ({ active, retired: [], projects: null, hostRows: Object.fromEntries(active.map((a) => [a.cutexSessionId, { projectId: "r244", projectName: "r244" }])) }) as unknown as SidebarSnapshot;
  const layout = (snap: SidebarSnapshot, now: number) => layoutGroup(buildSidebar(snap).groups[0]!, ctx(now), false);

  it("agents created minutes ago never fold: their last conversation is under 30 minutes old (not a bug)", () => {
    // The acceptance run: 甲 last spoke 5–9 minutes before the look, 乙 was busy, the Director never folds.
    const snap = snapshot([agent("r244-甲", { created: NOW - 25 * MIN, conversation: NOW - 9 * MIN }), agent("r244-乙", { created: NOW - 25 * MIN, conversation: NOW - MIN }), agent("never-spoke", { created: NOW - 20 * MIN, conversation: null })]);
    const l = layout(snap, NOW);
    expect(ids(l.full)).toEqual(["never-spoke", "r244-甲", "r244-乙"]);
    expect(l.idle).toEqual([]);
    // The same agents once they have been quiet for 30 minutes fold by themselves.
    expect(ids(layout(snap, NOW + 30 * MIN).idle)).toEqual(["never-spoke", "r244-甲", "r244-乙"]);
  });

  it("a runtime restart (new generation, runtime events, updatedAt) neither reorders nor unfolds rows", () => {
    const before = snapshot([agent("b-idle", { created: NOW - 600 * MIN, conversation: NOW - 120 * MIN }), agent("a-idle", { created: NOW - 600 * MIN, conversation: NOW - 180 * MIN }), agent("c-recent", { created: NOW - 600 * MIN, conversation: NOW - 2 * MIN })]);
    const restarted = snapshot([agent("b-idle", { created: NOW - 600 * MIN, conversation: NOW - 120 * MIN, generation: 2, lastEventAt: NOW, updatedAt: NOW }), ...before.active.slice(1)]);
    for (const snap of [before, restarted]) {
      const l = layout(snap, NOW);
      expect(ids(l.full)).toEqual(["c-recent"]);
      expect(ids(l.idle)).toEqual(["a-idle", "b-idle"]);
    }
    expect(buildSidebar(restarted).groups[0]!.online.map((r) => [r.id, r.lastActivity])).toEqual(buildSidebar(before).groups[0]!.online.map((r) => [r.id, r.lastActivity]));
  });
});
