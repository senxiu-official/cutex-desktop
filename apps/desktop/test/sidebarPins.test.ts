// Sidebar pins / folds (owner decisions 2026-10-16, .local/sidebar-investigation/REPORT.md): a pinned
// agent is always a full row, pinned quick chats sort first, collapsed groups keep their pins listed.
import { describe, expect, it } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { AgentSignal } from "../src/renderer/src/lib/agentAttention";
import { foldLabel, layoutGroup, layoutSidebar, pinnedRows, type LayoutPrefs } from "../src/renderer/src/lib/sidebarLayout";
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

const prefs: LayoutPrefs = { grouping: "all", noOnline: "collapse", running: "avatars", foldIdle: true };
const ctx = (signals: Record<string, AgentSignal> = {}, over: Partial<Parameters<typeof layoutSidebar>[1]> = {}) => ({
  signalOf: (id: string) => signals[id],
  selectedId: null,
  starred: new Set<string>(),
  prefs,
  ...over,
});
const ids = (rows: readonly AgentRow[]) => rows.map((r) => r.id);

describe("pinned agents (decision 1)", () => {
  it("a pinned online idle agent is a full row, not in 「N 个空闲」", () => {
    const l = layoutGroup(project("p", [row("a"), row("pin", "idle", { pinned: true }), row("b")]), ctx(), false);
    expect(ids(l.full)).toEqual(["pin"]);
    expect(ids(l.idle)).toEqual(["a", "b"]);
  });

  it("a pinned running agent is a full row in compact / avatar mode", () => {
    for (const running of ["avatars", "compact"] as const) {
      const l = layoutGroup(project("p", [row("run", "running"), row("pinRun", "running", { pinned: true })]), ctx({ run: "running", pinRun: "running" }, { prefs: { ...prefs, running } }), false);
      expect(ids(l.full)).toEqual(["pinRun"]);
      expect(ids(l.running)).toEqual(["run"]);
    }
  });

  it("a pinned offline agent is a full row, not in 离线 N", () => {
    const l = layoutGroup(project("p", [row("off", "offline"), row("pinOff", "offline", { pinned: true })]), ctx(), false);
    expect(ids(l.full)).toEqual(["pinOff"]);
    expect(ids(l.offline)).toEqual(["off"]);
  });

  it("full rows sort Director > pinned > name", () => {
    const l = layoutGroup(project("p", [row("zed", "needsInput"), row("pinB", "idle", { pinned: true }), row("dir", "idle", { director: true }), row("pinA", "offline", { pinned: true })]), ctx({ zed: "needsYou" }), false);
    expect(ids(l.full)).toEqual(["dir", "pinA", "pinB", "zed"]);
    expect([row("b"), row("a", "idle", { pinned: true })].sort(compareRows).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("a collapsed (quiet) project keeps its pins in `full` for the row under it", () => {
    const quiet = project("quiet", [row("q1", "offline"), row("qPin", "offline", { pinned: true })]);
    const [l] = layoutSidebar([quiet], ctx()).main;
    expect(l!.mode).toBe("collapsed");
    expect(ids(pinnedRows(l!.full))).toEqual(["qPin"]);
    // Others: nothing pinned, nothing listed under the one row.
    const [plain] = layoutSidebar([project("plain", [row("x", "offline")])], ctx()).main;
    expect(pinnedRows(plain!.full)).toEqual([]);
  });

  it("星标展开: an unstarred project under 其他项目 keeps its pins too", () => {
    const l = layoutSidebar([project("p", [row("a"), row("pin", "idle", { pinned: true })])], ctx({}, { prefs: { ...prefs, grouping: "starred" } }));
    expect(l.others[0]!.mode).toBe("collapsed");
    expect(ids(pinnedRows(l.others[0]!.full))).toEqual(["pin"]);
  });

  it("a pinned agent stays a full row while its host loads (unconfirmed)", () => {
    const l = layoutGroup(project("p", [row("u", "unknown"), row("uPin", "unknown", { pinned: true })]), ctx(), false);
    expect(ids(l.full)).toEqual(["uPin"]);
    expect(ids(l.idle)).toEqual(["u"]);
  });

  it("pinned quick chats sort first, then newest first", () => {
    const chats = [row("old", "idle", { last: 10 }), row("new", "idle", { last: 30 }), row("pinOld", "idle", { last: 5, pinned: true }), row("mid", "idle", { last: 20 })];
    expect(chats.sort(compareChats).map((r) => r.id)).toEqual(["pinOld", "new", "mid", "old"]);
  });
});

describe("collapsed means collapsed (decision 2)", () => {
  it("unconfirmed rows (host loading) stay where their snapshot put them", () => {
    const g = project("p", [row("idle", "unknown"), row("busy", "unknown", { turn: "t9" }), row("gone", "unknown", { snapshot: "offline" }), row("ok")]);
    const l = layoutGroup(g, ctx(), false);
    expect(ids(l.idle)).toEqual(["idle", "ok"]);
    expect(ids(l.running)).toEqual(["busy"]);
    expect(ids(l.offline)).toEqual(["gone"]);
    expect(l.full).toEqual([]);
    expect(l.runningCount).toBe(0);
    // An unconfirmed row its snapshot shows as erroring has no fold to sit in: a full row.
    const err = { ...row("err", "unknown"), session: { ...row("err").session, runtime: { status: "error", activeTurnId: null } } } as AgentRow;
    expect(ids(layoutGroup(project("p", [err]), ctx(), false).full)).toEqual(["err"]);
  });

  it("a done idle agent stays in the fold with a ✓ (idleDone); needs-you / error still leave it", () => {
    const g = project("p", [row("a"), row("d1"), row("d2"), row("need", "needsInput"), row("bad")]);
    const l = layoutGroup(g, ctx({ d1: "done", d2: "done", need: "needsYou", bad: "error" }), false);
    expect(ids(l.idle)).toEqual(["a", "d1", "d2"]);
    expect(l.idleDone).toEqual(["d1", "d2"]);
    expect(ids(l.full)).toEqual(["bad", "need"]);
    // Still counted for the section / project summaries (and listed by the 需要你 strip).
    expect(l.attentionCount).toBe(4);
  });

  it("with idle folding off (globally or 「在线空闲不收起」) a done agent is a full row", () => {
    const g = project("p", [row("a"), row("d", "idle")]);
    expect(ids(layoutGroup(g, ctx({ d: "done" }, { prefs: { ...prefs, foldIdle: false } }), false).full)).toEqual(["a", "d"]);
    const l = layoutGroup(g, ctx({ d: "done" }, { idleUnfolded: new Set(["p"]) }), false);
    expect(l.idleDone).toEqual([]);
    expect(ids(l.full)).toEqual(["a", "d"]);
  });

  it("a done agent that is running / offline is not in the idle fold", () => {
    const l = layoutGroup(project("p", [row("off", "offline")]), ctx({ off: "done" }), false);
    expect(ids(l.full)).toEqual(["off"]);
    expect(l.idleDone).toEqual([]);
  });

  it("fold header counts: 「3 个空闲 · 2 完成」, only done 「2 完成」", () => {
    expect(foldLabel(5, 2)).toEqual({ idle: 3, done: 2 });
    expect(foldLabel(2, 2)).toEqual({ idle: 0, done: 2 });
    expect(foldLabel(4, 0)).toEqual({ idle: 4, done: 0 });
  });

  it("the sidebar's own group ids are claimable (not dropped as unclaimed legacy entries)", () => {
    expect([...SIDEBAR_GROUP_IDS].sort()).toEqual(["__chats__", "__independent__", "__other__"]);
  });
});
