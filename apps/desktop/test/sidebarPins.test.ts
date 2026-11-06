// Sidebar pins / folds (owner decisions 2026-10-16, .local/sidebar-investigation/REPORT.md; design 060 B): a
// pinned agent is always a big 现在 row, pinned quick chats sort first, collapsed groups keep their pins listed.
import { describe, expect, it } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { AgentSignal } from "../src/renderer/src/lib/agentAttention";
import { layoutGroup, layoutSidebar, pinnedRows, type LayoutPrefs } from "../src/renderer/src/lib/sidebarLayout";
import { compareChats, compareRows, SIDEBAR_GROUP_IDS, type AgentRow, type AgentStatus, type ProjectGroup } from "../src/renderer/src/lib/sidebar";

function row(id: string, status: AgentStatus = "idle", over: { director?: boolean; pinned?: boolean; last?: number; snapshot?: "online" | "offline"; turn?: string | null } = {}): AgentRow {
  const session = {
    cutexSessionId: id,
    displayName: id,
    lifecycle: "active",
    createdAt: null,
    runtime: { status: over.snapshot ?? (status === "offline" ? "offline" : "online"), activeTurnId: over.turn ?? (status === "running" ? "t1" : null), activeTurnObservedAt: null },
  } as unknown as SessionResource;
  return { id, name: id, subtitle: "", status, isDirector: over.director ?? false, pinned: over.pinned ?? false, lastActivity: over.last ?? 0, profile: null, color: null, session };
}

/** Rows go to the online / offline list like lib/sidebar (an unconfirmed row by its snapshot). */
function project(id: string, rows: AgentRow[]): ProjectGroup {
  const off = (r: AgentRow) => r.status === "offline" || (r.status === "unknown" && r.session.runtime.status === "offline");
  return { kind: "project", id, name: id, badge: "", color: "blue", online: rows.filter((r) => !off(r)), offline: rows.filter(off) };
}

const prefs: LayoutPrefs = { grouping: "all", noOnline: "collapse", running: "avatars" };
const ctx = (signals: Record<string, AgentSignal> = {}, over: Partial<Parameters<typeof layoutSidebar>[1]> = {}) => ({
  signalOf: (id: string) => signals[id],
  selectedId: null,
  starred: new Set<string>(),
  prefs,
  ...over,
});
const ids = (rows: readonly AgentRow[]) => rows.map((r) => r.id);

describe("pinned agents (decision 1)", () => {
  it("a pinned idle agent is a big listed row, not folded", () => {
    const l = layoutGroup(project("p", [row("a"), row("pin", "idle", { pinned: true }), row("b")]), ctx(), false);
    expect(ids(l.big)).toEqual(["pin"]);
    expect(ids(l.idle)).toEqual(["a", "b"]);
  });

  it("a pinned running agent is a big row in compact / avatar mode", () => {
    for (const running of ["avatars", "compact"] as const) {
      const l = layoutGroup(project("p", [row("run", "running"), row("pinRun", "running", { pinned: true })]), ctx({ run: "running", pinRun: "running" }, { prefs: { ...prefs, running } }), false);
      expect(ids(l.big)).toEqual(["pinRun"]);
      expect(ids(l.running)).toEqual(["run"]);
    }
  });

  it("a pinned offline agent is a big row, not folded", () => {
    const l = layoutGroup(project("p", [row("off", "offline"), row("pinOff", "offline", { pinned: true })]), ctx(), false);
    expect(ids(l.big)).toEqual(["pinOff"]);
    expect(ids(l.offline)).toEqual(["off"]);
  });

  it("big rows sort Director > pinned > online > name", () => {
    const l = layoutGroup(project("p", [row("zed", "needsInput"), row("pinB", "idle", { pinned: true }), row("dir", "idle", { director: true }), row("pinA", "offline", { pinned: true })]), ctx({ zed: "needsYou" }), false);
    expect(ids(l.big)).toEqual(["dir", "pinB", "pinA", "zed"]);
    expect([row("b"), row("a", "idle", { pinned: true })].sort(compareRows).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("a collapsed (quiet) project keeps its pins in `big` for the row under it", () => {
    const quiet = project("quiet", [row("q1", "offline"), row("qPin", "offline", { pinned: true })]);
    const [l] = layoutSidebar([quiet], ctx()).main;
    expect(l!.mode).toBe("collapsed");
    expect(ids(pinnedRows(l!.big))).toEqual(["qPin"]);
    // Others: nothing pinned, nothing listed under the one row.
    const [plain] = layoutSidebar([project("plain", [row("x", "offline")])], ctx()).main;
    expect(pinnedRows(plain!.big)).toEqual([]);
  });

  it("星标展开: an unstarred project under 其他项目 keeps its pins too", () => {
    const l = layoutSidebar([project("p", [row("a"), row("pin", "idle", { pinned: true })])], ctx({}, { prefs: { ...prefs, grouping: "starred" } }));
    expect(l.others[0]!.mode).toBe("collapsed");
    expect(ids(pinnedRows(l.others[0]!.big))).toEqual(["pin"]);
  });

  it("a pinned agent stays a big row while its host loads (unconfirmed)", () => {
    const l = layoutGroup(project("p", [row("u", "unknown"), row("uPin", "unknown", { pinned: true })]), ctx(), false);
    expect(ids(l.big)).toEqual(["uPin"]);
    expect(ids(l.idle)).toEqual(["u"]);
  });

  it("pinned quick chats sort first, then newest first", () => {
    const chats = [row("old", "idle", { last: 10 }), row("new", "idle", { last: 30 }), row("pinOld", "idle", { last: 5, pinned: true }), row("mid", "idle", { last: 20 })];
    expect(chats.sort(compareChats).map((r) => r.id)).toEqual(["pinOld", "new", "mid", "old"]);
  });
});

describe("reconnects never move rows (decision 2)", () => {
  it("unconfirmed rows (host loading) stay where their snapshot put them", () => {
    const g = project("p", [row("idle", "unknown"), row("busy", "unknown", { turn: "t9" }), row("gone", "unknown", { snapshot: "offline" }), row("ok")]);
    const l = layoutGroup(g, ctx(), false);
    // Online (by snapshot) folds into 在线空闲, offline into 离线, each by name.
    expect(ids(l.idle)).toEqual(["idle", "ok"]);
    expect(ids(l.offline)).toEqual(["gone"]);
    // Last seen running: stays in 现在 (not counted as running, not online until confirmed).
    expect(ids(l.running)).toEqual(["busy"]);
    expect(l.big).toEqual([]);
    expect(l.runningCount).toBe(0);
    expect(l.onlineCount).toBe(1);
  });

  it("a done agent is 最近; needs-you / error are big 现在 rows", () => {
    const g = project("p", [row("a"), row("d1"), row("d2"), row("need", "needsInput"), row("bad")]);
    const l = layoutGroup(g, ctx({ d1: "done", d2: "done", need: "needsYou", bad: "error" }), false);
    expect(ids(l.recent)).toEqual(["d1", "d2"]);
    expect(ids(l.big)).toEqual(["bad", "need"]);
    expect(ids(l.idle)).toEqual(["a"]);
    // Still counted for the section / project summaries (and listed by the 需要你 strip).
    expect(l.attentionCount).toBe(4);
  });

  it("a done offline agent is 最近 too", () => {
    const l = layoutGroup(project("p", [row("off", "offline")]), ctx({ off: "done" }), false);
    expect(ids(l.recent)).toEqual(["off"]);
  });

  it("the sidebar's own group ids are claimable (not dropped as unclaimed legacy entries)", () => {
    expect([...SIDEBAR_GROUP_IDS].sort()).toEqual(["__chats__", "__independent__", "__other__"]);
  });
});
