import { describe, expect, it } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import { buildSidebar, isQuickChat, moveProject, orderGroups, type SidebarGroup } from "../src/renderer/src/lib/sidebar";

function session(id: string, over: Partial<SessionResource> & { status?: string; activeTurnId?: string | null } = {}): SessionResource {
  const { status = "online", activeTurnId = null, ...rest } = over;
  return {
    contractVersion: 2,
    cutexSessionId: id,
    revision: 1,
    lifecycle: "active",
    retiredAt: null,
    hostId: "h",
    displayName: id,
    threadName: null,
    cwd: null,
    profile: null,
    configuredProfile: null,
    launchedProfile: null,
    effectiveNextLaunch: { profile: null, source: "unavailable" },
    groups: [],
    registrationClass: null,
    visible: true,
    native: { threadId: null, schema: null },
    runtime: {
      backend: "managed",
      status,
      appServerConnected: status === "online",
      runtimeGeneration: 1,
      runtimeAgentId: null,
      activeTurnId,
      activeTurnObservedAt: null,
      threadStatus: null,
      threadSettings: null,
      requiresVisibleTerminal: false,
      tuiAttached: false,
      lastEventAt: null,
      lastError: null,
    },
    runtimeDefaults: null,
    activity: null,
    focus: null,
    management: null,
    createdAt: null,
    updatedAt: null,
    ...rest,
  };
}

const row = (id: string, projectId: string | null) => ({
  id,
  name: id,
  kind: "Agent",
  hostId: "h",
  profile: null,
  projectId,
  cwd: null,
  state: "",
  generation: 1,
  nativeId: null,
});

describe("buildSidebar", () => {
  it("groups by project with online/offline/archived, director first, independents last", () => {
    const { groups, archived } = buildSidebar(
      {
        active: [
          session("worker", { activeTurnId: "t" }),
          session("director"),
          session("sleepy", { status: "offline" }),
          session("loner"),
          session("asker"),
        ],
        retired: [session("old", { lifecycle: "retired" })],
        projects: {
          schema: "x",
          projects: [
            {
              project_id: "p1",
              authority_epoch: 1,
              director_cutex_session_id: "director",
              presentation: { display_name: "Project One", badge_label: "P1", color: "cyan" },
              active_member_count: 3,
              lifecycle: "active",
            },
          ],
        },
        hostRows: {
          worker: row("worker", "p1"),
          director: row("director", "p1"),
          sleepy: row("sleepy", "p1"),
          old: row("old", "p1"),
          asker: row("asker", "p1"),
          loner: row("loner", null),
        },
      },
      { needsInput: new Set(["asker"]) },
    );

    expect(groups.map((g) => g.kind)).toEqual(["project", "independent"]);
    const project = groups[0]!;
    // Stable order: Director, then by name — status does not reorder rows.
    expect(project.online.map((r) => r.id)).toEqual(["director", "asker", "worker"]);
    expect(project.online.map((r) => r.status)).toEqual(["idle", "needsInput", "running"]);
    expect(project.offline.map((r) => r.id)).toEqual(["sleepy"]);
    expect(archived.map((r) => r.id)).toEqual(["old"]);
    expect(groups[1]!.online.map((r) => r.id)).toEqual(["loner"]);
  });

  it("gives rows avatar initials without the project's shared prefix / revision suffix", () => {
    const names = ["proj-ceo-r1", "proj-gpt-research-r1", "proj-ops-r2", "solo-r3"];
    const { groups } = buildSidebar({
      active: names.map((n) => session(n, n === "proj-ops-r2" ? { status: "offline" } : {})),
      retired: [],
      projects: { schema: "x", projects: [{ project_id: "demo2026", authority_epoch: 1, director_cutex_session_id: "proj-ceo-r1", presentation: { display_name: "DEMO2026", badge_label: "V", color: "blue" }, active_member_count: 3, lifecycle: "active" }] },
      hostRows: Object.fromEntries(names.map((n) => [n, row(n, n === "solo-r3" ? null : "demo2026")])),
    });
    const all = groups.flatMap((g) => [...g.online, ...g.offline]);
    expect(Object.fromEntries(all.map((r) => [r.name, r.initial]))).toEqual({ "proj-ceo-r1": "C", "proj-gpt-research-r1": "G", "proj-ops-r2": "O", "solo-r3": "S" });
  });

  it("splits quick chats into their own newest-first list only when enabled", () => {
    const chat = (id: string, at: string) => session(id, { registrationClass: "local_only", formalAgentName: null, updatedAt: at });
    const snapshot = {
      active: [
        session("agent"),
        chat("older", "2026-10-05T10:00:00Z"),
        chat("newer", "2026-10-06T10:00:00Z"),
        // local_only but with a formal name: stays an agent.
        session("named", { registrationClass: "local_only", formalAgentName: "Named" }),
      ],
      retired: [],
      projects: null,
      hostRows: { agent: row("agent", null), older: { ...row("older", null), kind: "Session" }, newer: { ...row("newer", null), kind: "Session" }, named: row("named", null) },
    };
    const on = buildSidebar(snapshot, { chats: true });
    expect(on.chats.map((r) => r.id)).toEqual(["newer", "older"]);
    expect(on.groups.flatMap((g) => [...g.online, ...g.offline]).map((r) => r.id)).toEqual(["agent", "named"]);
    const off = buildSidebar(snapshot);
    expect(off.chats).toEqual([]);
    expect(off.groups[0]!.online.map((r) => r.id)).toEqual(["agent", "named", "newer", "older"]);
  });

  it("recognises quick chats by registration class, falling back to the host row kind", () => {
    expect(isQuickChat(session("a", { registrationClass: "persistent" }))).toBe(false);
    expect(isQuickChat(session("b", { registrationClass: "local_only" }))).toBe(true);
    expect(isQuickChat(session("c"), { ...row("c", null), kind: "Session" })).toBe(true);
    expect(isQuickChat(session("d"), row("d", null))).toBe(false);
  });
});

describe("project order", () => {
  const p = (id: string): SidebarGroup => ({ kind: "project", id, name: id, badge: "", color: "blue", online: [], offline: [] });
  const solo: SidebarGroup = { kind: "independent", id: "__independent__", online: [], offline: [] };
  const ids = (gs: SidebarGroup[]) => gs.map((g) => g.id);

  it("puts listed projects first, keeps the rest in automatic order, no-project last", () => {
    expect(ids(orderGroups([p("a"), p("b"), p("c"), solo], ["c", "a"]))).toEqual(["c", "a", "b", "__independent__"]);
    expect(ids(orderGroups([p("a"), p("b"), solo], []))).toEqual(["a", "b", "__independent__"]);
    expect(ids(orderGroups([p("a"), solo, p("b")], ["zzz", "b"]))).toEqual(["b", "a", "__independent__"]);
  });

  it("moves a dragged project before or after the drop target", () => {
    expect(moveProject(["a", "b", "c"], "c", "a", false)).toEqual(["c", "a", "b"]);
    expect(moveProject(["a", "b", "c"], "a", "b", true)).toEqual(["b", "a", "c"]);
    expect(moveProject(["a", "b", "c"], "b", "b", true)).toEqual(["a", "b", "c"]);
    expect(moveProject(["a", "b"], "a", "missing", false)).toEqual(["a", "b"]);
  });
});
