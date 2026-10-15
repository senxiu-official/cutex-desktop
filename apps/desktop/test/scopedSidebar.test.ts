// Multi-host sidebar merge (RFC §8.3 ★ Q8, P1 step 2a): lib/scopedSidebar.ts.
import { describe, expect, it } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { SidebarSnapshot } from "../src/shared/ipc";
import { mergeHostSidebars, scopedSignals } from "../src/renderer/src/lib/scopedSidebar";
import { buildSidebar, groupKey, liveStatusOf, onlineCount, rowKey } from "../src/renderer/src/lib/sidebar";
import { agentSignal, showsRunningRing } from "../src/renderer/src/lib/agentAttention";
import { layoutGroup, type LayoutContext } from "../src/renderer/src/lib/sidebarLayout";
import { hostKey } from "../src/renderer/src/lib/hostKeys";

function session(id: string, over: Partial<SessionResource> & { status?: string; activeTurnId?: string | null } = {}): SessionResource {
  const { status = "online", activeTurnId = null, ...rest } = over;
  return {
    contractVersion: 2, cutexSessionId: id, revision: 1, lifecycle: "active", retiredAt: null, hostId: "h", displayName: id, threadName: null, cwd: null,
    profile: null, configuredProfile: null, launchedProfile: null, effectiveNextLaunch: { profile: null, source: "unavailable" }, groups: [], registrationClass: null, visible: true,
    native: { threadId: null, schema: null },
    runtime: { backend: "managed", status, appServerConnected: status === "online", runtimeGeneration: 1, runtimeAgentId: null, activeTurnId, activeTurnObservedAt: null, threadStatus: null, threadSettings: null, requiresVisibleTerminal: false, tuiAttached: false, lastEventAt: null, lastError: null },
    runtimeDefaults: null, activity: null, focus: null, management: null, createdAt: null, updatedAt: null,
    ...rest,
  } as SessionResource;
}
const hostRow = (id: string, projectId: string | null, kind = "Agent") => ({ id, name: id, kind, hostId: "h", profile: null, projectId, cwd: null, state: "", generation: 1, nativeId: null });
const project = (id: string, name: string, director: string | null) => ({ project_id: id, authority_epoch: 1, director_cutex_session_id: director, presentation: { display_name: name, badge_label: name.slice(0, 2), color: "cyan" }, active_member_count: 1, lifecycle: "active" });

function snapshot(agents: [id: string, projectId: string | null, over?: Parameters<typeof session>[1]][], projects: ReturnType<typeof project>[]): SidebarSnapshot {
  return {
    active: agents.map(([id, , over]) => session(id, over)),
    retired: [],
    projects: { schema: "x", projects },
    hostRows: Object.fromEntries(agents.map(([id, p, over]) => [id, hostRow(id, p, over?.registrationClass === "local_only" ? "Session" : "Agent")])),
  } as unknown as SidebarSnapshot;
}

const local = snapshot(
  [["lead", "p1"], ["w", "p1"], ["solo", null], ["chat-l", null, { registrationClass: "local_only", formalAgentName: null, updatedAt: "2026-10-05T10:00:00Z" }]],
  [project("p1", "Bravo", "lead")],
);
const workstation = snapshot(
  [["kks-lead", "kks"], ["busy", "kks", { activeTurnId: "t1" }], ["same", "p1"], ["ops", null], ["chat-t", null, { registrationClass: "local_only", formalAgentName: null, updatedAt: "2026-10-06T10:00:00Z" }]],
  [project("kks", "Alpha", "kks-lead"), project("p1", "Charlie", null)],
);

describe("mergeHostSidebars", () => {
  it("one host gives today's sidebar, rows and groups keyed by that host", () => {
    const merged = mergeHostSidebars([{ hostId: "local", snapshot: local, chats: true }]);
    const plain = buildSidebar(local, { chats: true });
    expect(merged.groups.map((g) => [g.kind, g.online.map((r) => r.id)])).toEqual(plain.groups.map((g) => [g.kind, g.online.map((r) => r.id)]));
    expect(merged.groups.every((g) => g.hostId === "local")).toBe(true);
    expect(rowKey(merged.groups[0]!.online[0]!)).toBe(hostKey("local", "lead"));
  });

  it("merges projects of all hosts, keeps same-id projects apart, puts one 无项目 group per host last", () => {
    const merged = mergeHostSidebars([
      { hostId: "local", snapshot: local, chats: true },
      { hostId: "workstation", snapshot: workstation, chats: true },
    ]);
    // workstation' Alpha has a running agent: live projects first, then by name.
    expect(merged.groups.map((g) => [g.kind, g.hostId, g.kind === "project" ? g.name : null])).toEqual([
      ["project", "workstation", "Alpha"],
      ["project", "local", "Bravo"],
      ["project", "workstation", "Charlie"],
      ["independent", "local", null],
      ["independent", "workstation", null],
    ]);
    const keys = merged.groups.map(groupKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain(hostKey("local", "p1"));
    expect(keys).toContain(hostKey("workstation", "p1"));
    // Quick chats of both hosts, newest first, each with its host.
    expect(merged.chats.map((r) => [r.id, r.hostId])).toEqual([["chat-t", "workstation"], ["chat-l", "local"]]);
  });

  it("a host without a snapshot adds nothing (never seen yet)", () => {
    const merged = mergeHostSidebars([{ hostId: "local", snapshot: local }, { hostId: "alpha", snapshot: null }]);
    expect(merged.groups.every((g) => g.hostId === "local")).toBe(true);
  });

  it("a stale snapshot (host reconnecting) shows every agent unknown (connecting), never its cached online / running", () => {
    const last = snapshot([["a", null], ["b", null, { activeTurnId: "t1" }], ["c", null, { status: "offline" }]], []);
    const stale = mergeHostSidebars([{ hostId: "workstation", snapshot: last, statusUnknown: true }]);
    const rows = stale.groups.flatMap((g) => [...g.online, ...g.offline]);
    expect(rows.map((r) => [r.id, r.status])).toEqual([["a", "unknown"], ["b", "unknown"], ["c", "unknown"]]);
    // Each row stays in the list its snapshot put it in (no mass move to 离线).
    expect(stale.groups.flatMap((g) => g.online.map((r) => r.id))).toEqual(["a", "b"]);
    expect(stale.groups.flatMap((g) => g.offline.map((r) => r.id))).toEqual(["c"]);
    expect(stale.groups.map((g) => onlineCount(g))).toEqual([0]);
    const live = mergeHostSidebars([{ hostId: "workstation", snapshot: last }]);
    expect(live.groups.flatMap((g) => g.online.map((r) => r.status))).toEqual(["idle", "running"]);
  });

  it("while unknown, a status known live this run (session view / needs input) wins", () => {
    const last = snapshot([["a", null], ["b", null, { status: "offline" }], ["c", null], ["d", null]], []);
    const liveStatus = new Map([["b", "running" as const], ["c", "offline" as const]]);
    const stale = mergeHostSidebars([{ hostId: "workstation", snapshot: last, statusUnknown: true, liveStatus, needsInput: new Set(["d"]) }]);
    const status = Object.fromEntries(stale.groups.flatMap((g) => [...g.online, ...g.offline]).map((r) => [r.id, r.status]));
    expect(status).toEqual({ a: "unknown", b: "running", c: "offline", d: "needsInput" });
    expect(stale.groups.flatMap((g) => g.online.map((r) => r.id)).sort()).toEqual(["a", "b", "d"]);
    expect(stale.groups.flatMap((g) => g.offline.map((r) => r.id))).toEqual(["c"]);
  });
});

describe("scopedSignals", () => {
  it("reads each row's needs-you and marks from its own host, keyed by row key", () => {
    const both = snapshot([["x", null]], []);
    const merged = mergeHostSidebars([{ hostId: "local", snapshot: both }, { hostId: "workstation", snapshot: both }]);
    const rows = merged.groups.flatMap((g) => [...g.online, ...g.offline]);
    expect(rows).toHaveLength(2);
    const { signals, needs } = scopedSignals(
      rows,
      [
        { hostId: "local", pending: {}, approvals: null, delegations: null, ownerNotes: null, marks: { x: { at: 1, failed: false, turnId: null } } },
        { hostId: "workstation", pending: { x: ["item/commandExecution/requestApproval"] }, approvals: null, delegations: null, ownerNotes: null, marks: {} },
      ],
      "local",
    );
    expect(signals.get(hostKey("local", "x"))).toBe("done");
    expect(signals.get(hostKey("workstation", "x"))).toBe("needsYou");
    expect(needs.has(hostKey("local", "x"))).toBe(false);
    expect(needs.get(hostKey("workstation", "x"))?.count).toBe(1);
  });
});

describe("unconfirmed (unknown) status", () => {
  const view = (over: Partial<Parameters<typeof liveStatusOf>[0] & object> = {}, activeTurnId: string | null = null, pending = 0) => ({
    loading: false, connection: "live" as const, historySource: "live" as const, timeline: { pending: { size: pending }, activeTurnId }, ...over,
  });

  it("liveStatusOf: only a loaded, connected view tells a status", () => {
    expect(liveStatusOf(undefined)).toBeNull();
    expect(liveStatusOf(view({ loading: true }, "t1"))).toBeNull();
    expect(liveStatusOf(view({ connection: "connecting" }, "t1"))).toBeNull();
    expect(liveStatusOf(view({ connection: "retrying" }))).toBeNull();
    expect(liveStatusOf(view({ historySource: "archived" }))).toBeNull();
    expect(liveStatusOf(view({}, "t1"))).toBe("running");
    expect(liveStatusOf(view({}, null))).toBe("idle");
    expect(liveStatusOf(view({}, "t1", 1))).toBe("needsInput");
    expect(liveStatusOf(view({ historySource: "offline" }))).toBe("offline");
  });

  it("signal unknown: no running ring from the cached turn", () => {
    const last = snapshot([["b", null, { activeTurnId: "t1" }]], []);
    const [row] = mergeHostSidebars([{ hostId: "h", snapshot: last, statusUnknown: true }]).groups[0]!.online;
    const signal = agentSignal(row!, undefined, undefined);
    expect(signal).toBe("unknown");
    expect(showsRunningRing(signal, row!.session)).toBe(false);
    expect(showsRunningRing("idle", row!.session)).toBe(true);
  });

  it("layout: unknown rows of the online list are full rows (not 「N 个空闲」 / running), offline-list ones stay in 离线", () => {
    const last = snapshot([["a", null], ["b", null, { activeTurnId: "t1" }], ["c", null, { status: "offline" }]], []);
    const group = mergeHostSidebars([{ hostId: "h", snapshot: last, statusUnknown: true }]).groups[0]!;
    const ctx: LayoutContext = { signalOf: () => undefined, selectedId: null, starred: new Set(), prefs: { grouping: "all", noOnline: "collapse", running: "compact", foldIdle: true } as LayoutContext["prefs"] };
    const layout = layoutGroup(group, ctx, false);
    expect(layout.full.map((r) => r.id)).toEqual(["a", "b"]);
    expect(layout.idle).toEqual([]);
    expect(layout.running).toEqual([]);
    expect(layout.runningCount).toBe(0);
    expect(layout.offline.map((r) => r.id)).toEqual(["c"]);
  });
});
