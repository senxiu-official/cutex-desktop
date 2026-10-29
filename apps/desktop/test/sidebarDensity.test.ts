// Sidebar density for big projects (owner 2026-10-21: "DEMO", 51 agents all named demo-…): the group's
// shared name prefix is dropped from the shown names (lib/sidebarNames), only the Director, pins,
// needs-you / error and running agents get the big IM row (lib/sidebarLayout bigRow), the other full
// rows are compact and capped at RECENT_CAP before 「最近活跃 +N」 (capRecent).
import { describe, expect, it } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { SidebarSnapshot } from "../src/shared/ipc";
import type { AgentSignal } from "../src/renderer/src/lib/agentAttention";
import { groupNamePrefix, sharedNamePrefixes, shortNames, stripNamePrefix } from "../src/renderer/src/lib/sidebarNames";
import { bigRow, capRecent, layoutGroup, RECENT_CAP, type LayoutPrefs } from "../src/renderer/src/lib/sidebarLayout";
import { buildSidebar, shownName, type AgentRow, type AgentStatus, type ProjectGroup } from "../src/renderer/src/lib/sidebar";

describe("the group's shared name prefix", () => {
  it("the longest prefix ending at a separator that ≥ 60 % of the agents share", () => {
    expect(groupNamePrefix(["demo-a", "demo-b", "demo-c"])).toBe("demo-");
    // 3 of 5 = 60 %: passes; 2 of 5: does not.
    expect(groupNamePrefix(["demo-a", "demo-b", "demo-c", "x-d", "y-e"])).toBe("demo-");
    expect(groupNamePrefix(["demo-a", "demo-b", "foo-c", "x-d", "y-e"])).toBe("");
    // Longest wins: "demo-qc-" is shared by 3 of 4.
    expect(sharedNamePrefixes(["demo-qc-a", "demo-qc-b", "demo-qc-c", "demo-run"])).toEqual(["demo-qc-", "demo-"]);
  });

  it("every separator counts: - _ . : / and space", () => {
    for (const sep of ["-", "_", ".", ":", "/", " "]) expect(groupNamePrefix([`abc${sep}x`, `abc${sep}y`])).toBe(`abc${sep}`);
    // Not a separator: no prefix.
    expect(groupNamePrefix(["abcx", "abcy"])).toBe("");
    expect(groupNamePrefix(["abc+x", "abc+y"])).toBe("");
  });

  it("at least 3 characters (separator included), and at least two agents", () => {
    expect(groupNamePrefix(["a-x", "a-y", "a-z"])).toBe("");
    expect(groupNamePrefix(["ab-x", "ab-y"])).toBe("ab-");
    expect(groupNamePrefix(["demo-only"])).toBe("");
    expect(groupNamePrefix([])).toBe("");
  });

  it("case-insensitive; a name that is only the prefix (nothing after it) does not count", () => {
    expect(groupNamePrefix(["DEMO-a", "demo-B"])).toBe("demo-");
    expect(groupNamePrefix(["demo-", "demo-", "demo-a"])).toBe("");
  });

  it("strips the longest prefix a name has, keeping its case; null when nothing (or only separators) would remain", () => {
    const chain = ["demo-qc-", "demo-"];
    expect(stripNamePrefix("demo-qc-batch-07", chain)).toBe("batch-07");
    expect(stripNamePrefix("demo-run", chain)).toBe("run");
    expect(stripNamePrefix("DEMO-Director", chain)).toBe("Director");
    expect(stripNamePrefix("other-agent", chain)).toBeNull();
    expect(stripNamePrefix("demo---", chain)).toBeNull();
    expect(stripNamePrefix("demo--x", chain)).toBe("x");
  });

  it("a rest without a letter falls back to the next shorter prefix (never a bare number)", () => {
    const names = ["demo-worker-01", "demo-worker-02", "demo-worker-03", "demo-qc"];
    expect(sharedNamePrefixes(names)).toEqual(["demo-worker-", "demo-"]);
    expect(shortNames(names).get("demo-worker-01")).toBe("worker-01");
    expect(shortNames(names).get("demo-qc")).toBe("qc");
    // Nothing shorter left: the whole name.
    expect(stripNamePrefix("demo-01", ["demo-"])).toBeNull();
  });

  it("shortNames lists only the names that get shorter", () => {
    const m = shortNames(["demo-director", "demo-qc-01", "demo-qc-02", "lonely"]);
    expect([...m]).toEqual([["demo-director", "director"], ["demo-qc-01", "qc-01"], ["demo-qc-02", "qc-02"]]);
    expect(shortNames(["alpha", "beta"]).size).toBe(0);
  });
});

function session(id: string, name: string): SessionResource {
  return { cutexSessionId: id, displayName: name, lifecycle: "active", createdAt: null, activity: null, runtime: { status: "online", activeTurnId: null } } as unknown as SessionResource;
}
const hostRow = (id: string, projectId: string | null) => ({ id, name: id, kind: "Agent", hostId: "x", profile: null, cwd: null, state: "online", generation: 1, nativeId: null, projectId, projectName: null });

describe("buildSidebar: shortName inside project groups", () => {
  const snapshot = {
    active: [session("d", "demo-director"), session("a", "demo-annotate-01"), session("b", "demo-cluster-02"), session("o", "helper"), session("s1", "demo-solo"), session("s2", "demo-other")],
    retired: [],
    hostRows: { d: hostRow("d", "scp"), a: hostRow("a", "scp"), b: hostRow("b", "scp"), o: hostRow("o", "scp"), s1: hostRow("s1", null), s2: hostRow("s2", null) },
    projects: { projects: [{ project_id: "scp", director_cutex_session_id: "d", presentation: { display_name: "DEMO", badge_label: "S", color: "blue" } }] },
  } as unknown as SidebarSnapshot;
  const model = buildSidebar(snapshot);
  const scp = model.groups.find((g) => g.kind === "project")!;
  const by = (name: string) => [...scp.online, ...scp.offline].find((r) => r.name === name)!;

  it("the project's rows show the rest; the full name stays in `name` (tooltips, search, menus)", () => {
    expect(shownName(by("demo-annotate-01"))).toBe("annotate-01");
    expect(by("demo-annotate-01").name).toBe("demo-annotate-01");
    // The Director is stripped too (its 主管 chip says what it is).
    expect(shownName(by("demo-director"))).toBe("director");
    expect(by("demo-director").isDirector).toBe(true);
    // Without the prefix: unchanged, no shortName.
    expect(by("helper").shortName).toBeUndefined();
    expect(shownName(by("helper"))).toBe("helper");
  });

  it("independent agents keep their whole names", () => {
    const solo = model.groups.find((g) => g.kind === "independent")!;
    expect(solo.online.map(shownName).sort()).toEqual(["demo-other", "demo-solo"]);
  });
});

function row(id: string, status: AgentStatus = "idle", over: { director?: boolean; pinned?: boolean; last?: number } = {}): AgentRow {
  const s = { cutexSessionId: id, displayName: id, lifecycle: "active", createdAt: null, runtime: { status: status === "offline" ? "offline" : "online", activeTurnId: status === "running" ? "t1" : null, activeTurnObservedAt: null } } as unknown as SessionResource;
  return { id, name: id, subtitle: "", status, isDirector: over.director ?? false, pinned: over.pinned ?? false, lastActivity: over.last ?? 0, profile: null, color: null, session: s };
}
const project = (rows: AgentRow[]): ProjectGroup => ({ kind: "project", id: "p", name: "p", badge: "", color: "blue", online: rows.filter((r) => r.status !== "offline"), offline: rows.filter((r) => r.status === "offline") });
const prefs: LayoutPrefs = { grouping: "all", noOnline: "collapse", running: "compact", foldIdle: true };
const ids = (rows: readonly AgentRow[]) => rows.map((r) => r.id);

describe("row style: big IM row vs compact", () => {
  it("big: Director, pinned, needs-you, error, running; everything else compact", () => {
    const plain = { isDirector: false, pinned: false, status: "idle" as AgentStatus };
    expect(bigRow({ ...plain, isDirector: true }, "idle")).toBe(true);
    expect(bigRow({ ...plain, pinned: true }, "idle")).toBe(true);
    for (const signal of ["needsYou", "error", "running"] as AgentSignal[]) expect(bigRow(plain, signal)).toBe(true);
    expect(bigRow({ ...plain, status: "running" }, "idle")).toBe(true);
    for (const signal of ["idle", "done", "offline", "unknown"] as AgentSignal[]) expect(bigRow(plain, signal)).toBe(false);
  });

  it("layoutGroup splits the full rows: big in the group's order, recent compact rows newest first", () => {
    const now = 10 * 60 * 60_000;
    const rows = [row("dir", "idle", { director: true, last: now - 50 * 60_000 }), row("pin", "idle", { pinned: true, last: now - 40 * 60_000 }), row("ask", "needsInput"), row("bad", "error"), row("fin", "idle", { last: now - 20 * 60_000 }), row("a", "idle", { last: now - 5 * 60_000 }), row("b", "idle", { last: now - 1 * 60_000 }), row("old", "idle", { last: now - 3 * 60 * 60_000 }), row("run", "running")];
    const signals: Record<string, AgentSignal> = { ask: "needsYou", bad: "error", fin: "done", run: "running" };
    const l = layoutGroup(project(rows), { signalOf: (k) => signals[k], selectedId: null, starred: new Set(), prefs, now }, false);
    expect(ids(l.big)).toEqual(["dir", "pin", "ask", "bad"]);
    expect(ids(l.recent)).toEqual(["b", "a", "fin"]);
    expect(ids(l.full).sort()).toEqual([...ids(l.big), ...ids(l.recent)].sort());
    // Running (compact mode) stays in its own rows; long idle folds.
    expect(ids(l.running)).toEqual(["run"]);
    expect(ids(l.idle)).toEqual(["old"]);
    // 「完整显示」: running agents become full rows, and big ones.
    const full = layoutGroup(project(rows), { signalOf: (k) => signals[k], selectedId: null, starred: new Set(), prefs: { ...prefs, running: "full" }, now }, false);
    expect(ids(full.big)).toContain("run");
  });
});

describe("「最近活跃 +N」: the compact recent rows capped per group", () => {
  const rows = Array.from({ length: 10 }, (_, i) => `r${i}`);

  it("the first RECENT_CAP (6) shown, the rest hidden", () => {
    expect(RECENT_CAP).toBe(6);
    const { shown, hidden } = capRecent(rows);
    expect(shown).toEqual(rows.slice(0, 6));
    expect(hidden).toEqual(rows.slice(6));
  });

  it("up to the cap nothing folds; expanded or searching shows every row", () => {
    expect(capRecent(rows.slice(0, 6)).hidden).toEqual([]);
    expect(capRecent(rows, { expanded: true })).toEqual({ shown: rows, hidden: [] });
    expect(capRecent(rows, { searching: true })).toEqual({ shown: rows, hidden: [] });
    expect(capRecent(rows, { cap: 2 }).shown).toEqual(["r0", "r1"]);
  });

  it("the open agent / a fresh one past the cap stays listed (in its place)", () => {
    const { shown, hidden } = capRecent(rows, { keep: (r) => r === "r8" });
    expect(shown).toEqual([...rows.slice(0, 6), "r8"]);
    expect(hidden).toEqual(["r6", "r7", "r9"]);
  });
});
