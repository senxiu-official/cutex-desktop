// Design 060 §5 (owner 2026-11-05): one rule for the sidebar and the project view (lib/rosterTiers
// placeRoster: listed, then 「在线空闲 +N」 / 「离线 +N」), 「更早的项目」, the fold filter, and the pref migration
// from the old 离线 / 空闲 folds.
import { describe, expect, it } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { AgentSignal } from "../src/renderer/src/lib/agentAttention";
import { migrateOlderProjectsAfter, nextTierChange, olderAfterMs, placeRoster, RECENT_CAP, RECENT_MS, rosterTier } from "../src/renderer/src/lib/rosterTiers";
import { foldRows, layoutGroup, layoutSidebar, nextRosterChange, type LayoutContext } from "../src/renderer/src/lib/sidebarLayout";
import { groupMembers, NO_LOAD, tierOf, type MemberInput } from "../src/renderer/src/modules/project-view/model";
import { migrateRestOpen } from "../src/renderer/src/lib/prefs";
import type { AgentRow, AgentStatus, ProjectGroup } from "../src/renderer/src/lib/sidebar";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const NOW = Date.parse("2026-11-05T07:00:00Z");

function row(id: string, status: AgentStatus, last: number, over: { director?: boolean; pinned?: boolean; background?: boolean } = {}): AgentRow {
  const session = {
    cutexSessionId: id,
    displayName: id,
    lifecycle: "active",
    createdAt: null,
    runtime: { status: status === "offline" ? "offline" : "online", appServerConnected: true, activeTurnId: status === "running" ? "t1" : null, activeTurnObservedAt: null, backgroundWork: over.background ? { running: true } : undefined },
  } as unknown as SessionResource;
  return { id, name: id, subtitle: "", status, isDirector: over.director ?? false, pinned: over.pinned ?? false, lastActivity: last, profile: null, color: null, session };
}
function project(id: string, rows: AgentRow[]): ProjectGroup {
  return { kind: "project", id, name: id, badge: "", color: "blue", online: rows.filter((r) => r.status !== "offline"), offline: rows.filter((r) => r.status === "offline") };
}
const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id);
const ctx = (over: Partial<LayoutContext> = {}, signals: Record<string, AgentSignal> = {}): LayoutContext => ({
  signalOf: (k) => signals[k],
  selectedId: null,
  starred: new Set(),
  prefs: { grouping: "all", noOnline: "collapse", running: "full", olderAfter: 7 },
  now: NOW,
  ...over,
});

describe("rosterTier: one rule", () => {
  const at = (ago: number) => NOW - ago;
  it("现在: pinned / Director, wants the owner, running", () => {
    expect(rosterTier({ pinned: true, signal: "idle", lastActivity: 0 }, NOW)).toBe("now");
    expect(rosterTier({ isDirector: true, signal: "offline", lastActivity: 0 }, NOW)).toBe("now");
    for (const signal of ["needsYou", "error", "running"] as AgentSignal[]) expect(rosterTier({ signal, lastActivity: 0 }, NOW)).toBe("now");
    expect(rosterTier({ signal: "unknown", running: true, lastActivity: 0 }, NOW)).toBe("now");
  });
  it("最近: a finished turn not seen yet, something open, or used within the window (online or offline)", () => {
    expect(rosterTier({ signal: "done", lastActivity: 0 }, NOW)).toBe("recent");
    expect(rosterTier({ signal: "idle", busy: true, lastActivity: 0 }, NOW)).toBe("recent");
    expect(rosterTier({ signal: "offline", lastActivity: at(6 * DAY) }, NOW)).toBe("recent");
    expect(rosterTier({ signal: "idle", lastActivity: at(6 * DAY) }, NOW)).toBe("recent");
    expect(rosterTier({ signal: "offline", lastActivity: at(RECENT_MS) }, NOW)).toBe("rest");
  });
  it("nextTierChange: the earliest crossing still ahead", () => {
    expect(nextTierChange([at(DAY), at(3 * DAY), at(30 * DAY)], NOW)).toBe(at(3 * DAY) + RECENT_MS);
    expect(nextTierChange([at(30 * DAY)], NOW)).toBeNull();
  });
});

describe("P1: the sidebar and the project view agree", () => {
  // An offline agent active 20 minutes ago: the project view put it in 最近活跃, the old sidebar in 离线.
  const off = row("off", "offline", NOW - 20 * MIN);
  const member: MemberInput = { id: "off", name: "off", isDirector: false, signal: "offline", online: false, lastActivity: off.lastActivity };
  it("both call it 最近", () => {
    expect(ids(layoutGroup(project("p", [off]), ctx(), false).recent)).toEqual(["off"]);
    expect(tierOf(member, NO_LOAD, NOW)).toBe("recent");
  });
  it("the project view's tiers come from the shared rule", () => {
    const m = (id: string, signal: AgentSignal, ago: number): MemberInput => ({ id, name: id, isDirector: false, signal, online: signal !== "offline", lastActivity: NOW - ago });
    const g = groupMembers([m("need", "needsYou", DAY), m("bad", "error", DAY), m("run", "running", DAY), m("fresh", "idle", MIN), m("week", "offline", 3 * DAY), m("old", "offline", 10 * DAY), m("quiet", "idle", 10 * DAY)], () => NO_LOAD, NOW);
    expect(ids(g.needsYou).sort()).toEqual(["bad", "need"]);
    expect(ids(g.running)).toEqual(["run"]);
    // The same 7-day window as the sidebar (it was 30 minutes before the folds were unified).
    expect(ids(g.recent)).toEqual(["fresh", "week"]);
    expect(ids(g.idle)).toEqual(["quiet"]);
    expect(ids(g.offline)).toEqual(["old"]);
    // Something open (a delegation) keeps it recent.
    expect(tierOf(m("busy", "idle", 10 * DAY), { ...NO_LOAD, delegationsIn: 1 }, NOW)).toBe("recent");
  });
});

describe("listed, then 「在线空闲 +N」 and 「离线 +N」", () => {
  it("a background command keeps an agent listed", () => {
    const l = layoutGroup(project("p", [row("bg", "idle", NOW - 30 * DAY, { background: true }), row("q", "idle", NOW - 30 * DAY)]), ctx(), false);
    expect(ids(l.recent)).toEqual(["bg"]);
    expect(ids(l.idle)).toEqual(["q"]);
    expect(l.offline).toEqual([]);
  });
  it("one project's height does not grow with its headcount: everyone else folds by online state, by name", () => {
    const many = Array.from({ length: 40 }, (_, i) => row(`a${String(39 - i).padStart(2, "0")}`, i % 2 ? "offline" : "idle", NOW - (10 + i) * DAY));
    const l = layoutGroup(project("p", [...many, row("now", "idle", NOW - MIN)]), ctx(), false);
    expect(ids(l.recent)).toEqual(["now"]);
    expect(l.idle).toHaveLength(20);
    expect(l.offline).toHaveLength(20);
    expect(l.idle.every((r) => r.status !== "offline") && l.offline.every((r) => r.status === "offline")).toBe(true);
    expect(ids(l.idle)).toEqual([...ids(l.idle)].sort());
    expect(ids(l.offline)).toEqual([...ids(l.offline)].sort());
  });
  it("past the cap of recently worked: the newest RECENT_CAP listed, the others into their fold", () => {
    const rows = Array.from({ length: RECENT_CAP + 3 }, (_, i) => row(`r${i}`, i % 2 ? "offline" : "idle", NOW - (i + 1) * MIN));
    const l = layoutGroup(project("p", rows), ctx(), false);
    expect(ids(l.recent).sort()).toEqual(["r0", "r1", "r2", "r3", "r4"]);
    expect(ids(l.idle)).toEqual(["r6"]);
    expect(ids(l.offline)).toEqual(["r5", "r7"]);
  });
  it("a project with no online agent and nothing recent: the Director and 「离线 +N」 only", () => {
    const l = layoutGroup(project("p", [row("dir", "offline", NOW - 20 * DAY, { director: true }), row("x", "offline", NOW - 20 * DAY), row("y", "offline", NOW - 30 * DAY)]), ctx(), false);
    expect(ids(l.big)).toEqual(["dir"]);
    expect([l.running, l.recent, l.idle]).toEqual([[], [], []]);
    expect(ids(l.offline)).toEqual(["x", "y"]);
  });
  it("searching lists every match, nothing folds", () => {
    const l = layoutGroup(project("p", [row("x", "offline", NOW - 20 * DAY), row("y", "idle", NOW - 30 * DAY)]), ctx({ searching: true }), false);
    expect(ids(l.recent)).toEqual(["y", "x"]);
    expect([l.idle, l.offline]).toEqual([[], []]);
  });
  it("placeRoster keeps `keep` rows listed past the cap", () => {
    const xs = ["a", "b", "c"];
    const placed = placeRoster(xs, () => "recent", { online: () => true, lastOf: (x) => xs.indexOf(x), order: (a, b) => a.localeCompare(b), keep: (x) => x === "a", cap: 1 });
    expect(placed.recent).toEqual(["a", "c"]);
    expect(placed.idle).toEqual(["b"]);
  });
});

describe("fold filter", () => {
  const rows = [row("browser-chrome", "offline", 3), row("runtime-page", "idle", 2), row("wl-persona", "offline", 1)];
  it("collapsed: only the open agent; expanded: filtered by name", () => {
    expect(ids(foldRows(rows, { open: false, keep: (r) => r.id === "runtime-page" }))).toEqual(["runtime-page"]);
    expect(ids(foldRows(rows, { open: true }))).toEqual(ids(rows));
    expect(ids(foldRows(rows, { open: true, filter: " PAGE " }))).toEqual(["runtime-page"]);
    expect(foldRows(rows, { open: true, filter: "zzz" })).toEqual([]);
  });
});

describe("「更早的项目」", () => {
  const live = project("live", [row("l1", "idle", NOW - DAY)]);
  const stale = project("stale", [row("s1", "offline", NOW - 10 * DAY), row("s2", "idle", NOW - 12 * DAY)]);
  it("a project quiet for the threshold goes to the bottom fold", () => {
    const l = layoutSidebar([stale, live], ctx());
    expect(l.main.map((g) => g.group.id)).toEqual(["live"]);
    expect(l.older.map((g) => [g.group.id, g.mode])).toEqual([["stale", "collapsed"]]);
    expect(layoutSidebar([stale, live], ctx({ prefs: { ...ctx().prefs, olderAfter: 14 } })).older).toEqual([]);
    expect(layoutSidebar([stale, live], ctx({ prefs: { ...ctx().prefs, olderAfter: "off" } })).older).toEqual([]);
  });
  it("starred, open, wanting the owner, running or searching: never folds", () => {
    expect(layoutSidebar([stale], ctx({ starred: new Set(["stale"]) })).older).toEqual([]);
    expect(layoutSidebar([stale], ctx({ selectedId: "s1" })).older).toEqual([]);
    expect(layoutSidebar([stale], ctx({}, { s2: "needsYou" })).older).toEqual([]);
    expect(layoutSidebar([stale], ctx({}, { s1: "done" })).older).toEqual([]);
    expect(layoutSidebar([stale], ctx({ searching: true })).older).toEqual([]);
    expect(layoutSidebar([project("r", [row("r1", "running", NOW - 30 * DAY)])], ctx()).older).toEqual([]);
    // No known activity time: not old.
    expect(layoutSidebar([project("z", [row("z1", "idle", 0)])], ctx()).older).toEqual([]);
  });
  it("not in 星标展开 (其他项目 already lists them one row each) and not without a clock", () => {
    expect(layoutSidebar([stale], ctx({ prefs: { ...ctx().prefs, grouping: "starred" } })).older).toEqual([]);
    expect(layoutSidebar([stale], ctx({ now: undefined })).older).toEqual([]);
  });
  it("nextRosterChange includes the moment a project turns old", () => {
    const g = project("g", [row("x", "offline", NOW - 20 * DAY), row("y", "offline", NOW - 5 * DAY)]);
    // y leaves 最近 at 7 days, the project folds at 7 days of its newest activity: the same moment here.
    expect(nextRosterChange([g], NOW, undefined, 7)).toBe(NOW - 5 * DAY + 7 * DAY);
    expect(nextRosterChange([g], NOW, undefined, 14)).toBe(NOW - 5 * DAY + 7 * DAY);
    expect(nextRosterChange([g], NOW + 3 * DAY, undefined, 14)).toBe(NOW - 5 * DAY + 14 * DAY);
  });
  it("threshold pref", () => {
    expect(migrateOlderProjectsAfter(undefined)).toBe(7);
    expect(migrateOlderProjectsAfter(30)).toBe(7);
    for (const v of [3, 7, 14, "off"] as const) expect(migrateOlderProjectsAfter(v)).toBe(v);
    expect(olderAfterMs("off")).toBeNull();
    expect(olderAfterMs(3)).toBe(3 * DAY);
  });
});

describe("pref migration", () => {
  it("restOpen starts from the old expanded 离线 lists and 「在线空闲不收起」 projects", () => {
    expect(migrateRestOpen({ offlineOpen: ["a", "b"], idleUnfolded: ["b", "c"], idleOpen: ["z"] })).toEqual(["a", "b", "c"]);
    expect(migrateRestOpen({ restOpen: ["x"], offlineOpen: ["a"] })).toEqual(["x"]);
    expect(migrateRestOpen({})).toEqual([]);
    expect(migrateRestOpen({ offlineOpen: "bogus", idleUnfolded: [1, "k"] })).toEqual(["k"]);
  });
});
