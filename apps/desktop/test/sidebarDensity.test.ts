// Sidebar density for big projects (owner 2026-10-21: "DEMO", 51 agents all named demo-…): the group's
// shared name prefix is dropped from the shown names (lib/sidebarNames), only the Director, pins,
// needs-you / error and running agents get the big IM row (lib/sidebarLayout bigRow), the other full
// rows are compact; at most RECENT_CAP recently worked ones are listed (lib/rosterTiers placeRoster).
import { describe, expect, it } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { SidebarSnapshot } from "../src/shared/ipc";
import type { AgentSignal } from "../src/renderer/src/lib/agentAttention";
import { groupNamePrefix, sharedNamePrefixes, shortNames, stripNamePrefix } from "../src/renderer/src/lib/sidebarNames";
import { bigRow, layoutGroup, type LayoutPrefs } from "../src/renderer/src/lib/sidebarLayout";
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
const prefs: LayoutPrefs = { grouping: "all", noOnline: "collapse", running: "compact" };
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

  it("layoutGroup splits the rows: big 现在 in the group's order, 最近 compact rows newest first", () => {
    const day = 24 * 60 * 60_000;
    const now = 30 * day;
    const rows = [row("dir", "idle", { director: true, last: now - 50 * 60_000 }), row("pin", "idle", { pinned: true, last: now - 40 * 60_000 }), row("ask", "needsInput"), row("bad", "error"), row("fin", "idle", { last: now - 20 * 60_000 }), row("a", "idle", { last: now - 5 * 60_000 }), row("b", "idle", { last: now - 1 * 60_000 }), row("old", "idle", { last: now - 9 * day }), row("run", "running")];
    const signals: Record<string, AgentSignal> = { ask: "needsYou", bad: "error", fin: "done", run: "running" };
    const l = layoutGroup(project(rows), { signalOf: (k) => signals[k], selectedId: null, starred: new Set(), prefs, now }, false);
    expect(ids(l.big)).toEqual(["dir", "pin", "ask", "bad"]);
    // Drawn in the roster order (online first, then name), not by activity.
    expect(ids(l.recent)).toEqual(["a", "b", "fin"]);
    // Running (compact mode) stays in its own rows; not used for a week: 「在线空闲 +N」.
    expect(ids(l.running)).toEqual(["run"]);
    expect(ids(l.idle)).toEqual(["old"]);
    // 「完整显示」: running agents become full rows, and big ones.
    const full = layoutGroup(project(rows), { signalOf: (k) => signals[k], selectedId: null, starred: new Set(), prefs: { ...prefs, running: "full" }, now }, false);
    expect(ids(full.big)).toContain("run");
  });
});
