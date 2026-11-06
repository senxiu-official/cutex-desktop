// Sidebar 最近 by recency (design 060 B, owner 2026-11-05): an agent stays in 最近 while its last
// conversation activity is under RECENT_MS (7 days) old, online or offline, then moves to 其余. The
// activity time ignores runtime lifecycle and session metadata (cutex activity.lastConversationAt,
// never runtime.lastEventAt / updatedAt).
import { describe, expect, it } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { AgentSignal } from "../src/renderer/src/lib/agentAttention";
import { layoutGroup, nextRosterChange, type LayoutPrefs } from "../src/renderer/src/lib/sidebarLayout";
import { RECENT_MS } from "../src/renderer/src/lib/rosterTiers";
import { buildSidebar, conversationActivity, type AgentRow, type AgentStatus, type ProjectGroup } from "../src/renderer/src/lib/sidebar";
import type { SidebarSnapshot } from "../src/shared/ipc";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
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

const prefs: LayoutPrefs = { grouping: "all", noOnline: "collapse", running: "avatars" };
const ctx = (now: number | undefined, signals: Record<string, AgentSignal> = {}, over: Record<string, unknown> = {}) => ({ signalOf: (id: string) => signals[id], selectedId: null, starred: new Set<string>(), prefs, now, ...over });
const ids = (rows: readonly AgentRow[]) => rows.map((r) => r.id);

describe("最近 window", () => {
  const group = project([row("recent", "idle", NOW - 2 * DAY), row("old", "idle", NOW - 9 * DAY), row("run", "running", NOW - 20 * DAY), row("off", "offline", NOW - 3 * DAY), row("offOld", "offline", NOW - 30 * DAY)]);

  it("used this week (online or offline) is listed, older folds by online state; running is listed whatever its age", () => {
    const l = layoutGroup(group, ctx(NOW), false);
    expect(ids(l.recent)).toEqual(["recent", "off"]);
    expect(ids(l.idle)).toEqual(["old"]);
    expect(ids(l.offline)).toEqual(["offOld"]);
    expect(ids(l.running)).toEqual(["run"]);
  });

  it("the row folds when the clock crosses the window", () => {
    const crossing = NOW - 3 * DAY + RECENT_MS;
    expect(nextRosterChange([group], NOW)).toBe(crossing);
    expect(ids(layoutGroup(group, ctx(crossing - 1), false).recent)).toEqual(["recent", "off"]);
    expect(ids(layoutGroup(group, ctx(crossing), false).recent)).toEqual(["recent"]);
  });

  it("the live activity preview (lastOf) counts as activity", () => {
    const l = layoutGroup(group, ctx(NOW, {}, { lastOf: (r: AgentRow) => (r.id === "old" ? NOW - MIN : r.lastActivity) }), false);
    expect(ids(l.recent)).toEqual(["old", "recent", "off"]);
  });

  it("a finished turn not seen yet is 最近 however old", () => {
    const g = project([row("oldDone", "idle", NOW - 90 * DAY)]);
    expect(ids(layoutGroup(g, ctx(NOW, { oldDone: "done" }), false).recent)).toEqual(["oldDone"]);
  });

  it("Director and pins stay listed; the open long-quiet agent stays in its fold (opening never moves it)", () => {
    const g = project([row("dir", "idle", NOW - 30 * DAY, { director: true }), row("pin", "idle", NOW - 30 * DAY, { pinned: true }), row("sel", "idle", NOW - 30 * DAY), row("new", "idle", NOW - MIN)]);
    const l = layoutGroup(g, ctx(NOW, {}, { selectedId: "sel" }), false);
    expect(ids(l.big)).toEqual(["dir", "pin"]);
    expect(ids(l.recent)).toEqual(["new"]);
    expect(ids(l.idle)).toEqual(["sel"]);
  });

  it("without a clock nothing is 最近 by time", () => {
    expect(layoutGroup(group, ctx(undefined), false).recent).toEqual([]);
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

// r244 acceptance (2026-10-18), rules of design 060 B: brand-new agents, and whether a runtime restart reorders the sidebar.
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

  it("agents created minutes ago are 最近: their last conversation is recent", () => {
    const snap = snapshot([agent("r244-甲", { created: NOW - 25 * MIN, conversation: NOW - 9 * MIN }), agent("r244-乙", { created: NOW - 25 * MIN, conversation: NOW - MIN }), agent("never-spoke", { created: NOW - 20 * MIN, conversation: null })]);
    const l = layout(snap, NOW);
    // By shown name (the shared "r244-" prefix dropped): 甲 (jia), never-spoke, 乙 (yi).
    expect(ids(l.recent)).toEqual(["r244-甲", "never-spoke", "r244-乙"]);
    expect(l.idle).toEqual([]);
    // The same agents once they have been quiet for 7 days fold into 在线空闲 by themselves.
    expect(ids(layout(snap, NOW + 7 * DAY).idle)).toEqual(["r244-甲", "never-spoke", "r244-乙"]);
  });

  it("a runtime restart (new generation, runtime events, updatedAt) neither reorders nor unfolds rows", () => {
    const before = snapshot([agent("b-idle", { created: NOW - 30 * DAY, conversation: NOW - 8 * DAY }), agent("a-idle", { created: NOW - 30 * DAY, conversation: NOW - 9 * DAY }), agent("c-recent", { created: NOW - 30 * DAY, conversation: NOW - 2 * MIN })]);
    const restarted = snapshot([agent("b-idle", { created: NOW - 30 * DAY, conversation: NOW - 8 * DAY, generation: 2, lastEventAt: NOW, updatedAt: NOW }), ...before.active.slice(1)]);
    for (const snap of [before, restarted]) {
      const l = layout(snap, NOW);
      expect(ids(l.recent)).toEqual(["c-recent"]);
      expect(ids(l.idle)).toEqual(["a-idle", "b-idle"]);
    }
    expect(buildSidebar(restarted).groups[0]!.online.map((r) => [r.id, r.lastActivity])).toEqual(buildSidebar(before).groups[0]!.online.map((r) => [r.id, r.lastActivity]));
  });
});
