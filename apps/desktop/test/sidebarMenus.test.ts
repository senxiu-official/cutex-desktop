// Sidebar project / agent menus: the project menu's items (open, create, bulk, display prefs, copy,
// Director), 「在线空闲不收起」 as a host-keyed pref, and the agent menu's additions.
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import { normalizeEntries, type MenuAction, type MenuEntry } from "../src/renderer/src/lib/contextMenu";
import type { AgentRow, ProjectGroup, SidebarGroup } from "../src/renderer/src/lib/sidebar";

const projectMutation = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({}));
vi.mock("../src/renderer/src/bridge", () => ({ api: { projectMutation: (...args: unknown[]) => projectMutation(...args) }, onEvent: () => () => {} }));

const t = ((key: string, vars?: Record<string, string | number>) => (vars ? `${key}(${Object.values(vars).join(",")})` : key)) as never;

function session(id: string, over: { busy?: boolean; status?: string } = {}): SessionResource {
  return { cutexSessionId: id, displayName: id.toUpperCase(), lifecycle: "active", revision: 1, cwd: "/w", runtime: { status: over.status ?? "online", activeTurnId: over.busy ? "t" : null, runtimeGeneration: 1 } } as unknown as SessionResource;
}

function row(id: string, status: AgentRow["status"], director = false): AgentRow {
  return { id, name: id.toUpperCase(), subtitle: "", status, isDirector: director, pinned: false, lastActivity: 0, profile: null, color: null, session: session(id, { busy: status === "running", status: status === "offline" ? "offline" : "online" }) };
}

const group: ProjectGroup = {
  kind: "project",
  id: "p1",
  name: "Proj",
  badge: "",
  color: "blue",
  online: [row("dir", "idle", true), row("a", "idle"), row("b", "running")],
  offline: [row("c", "offline")],
};

const labels = (entries: MenuEntry[]) => normalizeEntries(entries).map((e) => (e === "separator" ? "|" : (e as MenuAction).label));
const find = (entries: MenuEntry[], label: string) => normalizeEntries(entries).find((e): e is MenuAction => e !== "separator" && e.label.startsWith(label));

async function seed(features: string[] = []) {
  const { useApp } = await import("../src/renderer/src/store");
  const sessions = ["dir", "a", "b", "c"].map((id) => session(id));
  useApp.setState({
    features: new Set(features),
    sidebar: {
      active: sessions,
      retired: [],
      hostRows: { a: { projectId: "p1" } },
      projects: { projects: [{ project_id: "p1", director_cutex_session_id: "dir", authority_epoch: 1, project_revision: 1, presentation: { display_name: "Proj", badge_label: "", color: "blue", revision: 2 } }] },
    } as never,
  });
  return useApp;
}

describe("project menu", () => {
  // The first import loads the whole menu / store graph; under a full parallel run that alone can take
  // longer than one test's 5 s budget.
  beforeAll(async () => {
    await import("../src/renderer/src/lib/projectMenus");
  }, 60_000);

  it("groups open / create / bulk / display / copy / edit items", async () => {
    await seed();
    const { projectMenu } = await import("../src/renderer/src/lib/projectMenus");
    const items = labels(projectMenu(group, "/w", false, () => {}, t));
    expect(items).toEqual([
      "menu.openProjectPage",
      "menu.openDirector(DIR)",
      "menu.allAgents",
      "menu.newAgentHere",
      "|",
      "menu.stopIdle(1)",
      "|",
      "menu.collapse",
      "menu.star",
      "menu.sidebarDisplay",
      "menu.moveToSection",
      "|",
      "menu.copy",
      "menu.renameProject",
      "remark.menu",
      "projects.addMember…",
      // Last, after a separator: 在主界面调整 (lead 2026-10-18).
      "|",
      "customize.sidebar.menu",
    ]);
    const open = find(projectMenu(group, "/w", false, null, t), "menu.openProjectPage")!;
    expect(labels(open.submenu!)).toEqual(["projects.tab.overview", "projects.tab.agents", "projects.tab.tasks", "projects.tab.memory", "projects.tab.settings"]);
  });

  it("添加成员… / 更换主管… open the agent tab with its picker", async () => {
    const useApp = await seed(["owner-rotation"]);
    const openPage = vi.fn();
    useApp.setState({ openPage } as never);
    const { projectMenu } = await import("../src/renderer/src/lib/projectMenus");
    find(projectMenu(group, null, false, null, t), "projects.addMember")!.onSelect();
    find(projectMenu(group, null, false, null, t), "projects.changeDirector")!.onSelect();
    expect(openPage.mock.calls).toEqual([
      ["projects.page", { project: "p1", tab: "agents", pick: "add" }],
      ["projects.page", { project: "p1", tab: "agents", pick: "director" }],
    ]);
  });

  it("停止在线空闲 skips the Director and busy agents, and asks first", async () => {
    const { idleStoppable } = await import("../src/renderer/src/lib/projectMenus");
    expect(idleStoppable(group).map((r) => r.id)).toEqual(["a"]);
    await seed();
    const { projectMenu } = await import("../src/renderer/src/lib/projectMenus");
    expect(find(projectMenu(group, null, false, null, t), "menu.stopIdle")!.confirm).toContain("menu.stopIdleConfirm");
  });

  it("全部标为已读 appears with turn marks and clears them on the project's host", async () => {
    await seed();
    const unread = await import("../src/renderer/src/lib/turnUnread");
    unread.recordTurnEnd("c", { turnId: "t1", status: "completed" }, false);
    const { projectMenu, markedRows } = await import("../src/renderer/src/lib/projectMenus");
    expect(markedRows(group, "local").map((r) => r.id)).toEqual(["c"]);
    find(projectMenu(group, null, false, null, t), "menu.markProjectRead")!.onSelect();
    expect("c" in unread.getTurnMarks()).toBe(false);
    expect(find(projectMenu(group, null, false, null, t), "menu.markProjectRead")).toBeUndefined();
  });

  it("「在线空闲不收起」 toggles a host-keyed pref; hidden while the global fold is off", async () => {
    await seed();
    const prefs = await import("../src/renderer/src/lib/prefs");
    const { projectMenu } = await import("../src/renderer/src/lib/projectMenus");
    // One level down, under 侧栏显示 › (not a stray click on the main menu).
    const item = () => find(find(projectMenu(group, null, false, null, t), "menu.sidebarDisplay")!.submenu!, "menu.idleUnfolded")!;
    expect(find(projectMenu(group, null, false, null, t), "menu.idleUnfolded")).toBeUndefined();
    item().onSelect();
    expect(prefs.hostListKeys("idleUnfolded", ["local"])).toHaveLength(1);
    expect(prefs.getUiPrefs().idleUnfolded).toEqual(["p1"]);
    item().onSelect();
    expect(prefs.getUiPrefs().idleUnfolded).toEqual([]);
    prefs.setUiPref("foldIdleAgents", false);
    expect(find(projectMenu(group, null, false, null, t), "menu.sidebarDisplay")).toBeUndefined();
    prefs.setUiPref("foldIdleAgents", true);
  });

  it("independent agents: no project-only items", async () => {
    await seed();
    const { projectMenu } = await import("../src/renderer/src/lib/projectMenus");
    const indep: SidebarGroup = { kind: "independent", id: "__independent__", online: [], offline: [] };
    const items = labels(projectMenu(indep, null, false, null, t));
    expect(items).toContain("menu.newIndependentAgent");
    for (const l of ["menu.openProjectPage", "menu.moveToSection", "menu.renameProject", "remark.menu", "menu.copy"]) expect(items).not.toContain(l);
  });

  it("轮换主管 only with owner-rotation", async () => {
    await seed(["owner-rotation"]);
    const { projectMenu } = await import("../src/renderer/src/lib/projectMenus");
    expect(labels(projectMenu(group, null, false, null, t))).toContain("projects.rotation.menu");
  });

  it("清除主管 only with project-optional-director and a Director; armed, then clear_director on the project's revision", async () => {
    const useApp = await seed();
    const { projectMenu } = await import("../src/renderer/src/lib/projectMenus");
    expect(find(projectMenu(group, null, false, null, t), "projects.clearDirector")).toBeUndefined();
    await seed(["project-optional-director"]);
    const refresh = vi.fn(async () => {});
    useApp.setState({ refreshHostSidebar: refresh } as never);
    const clear = find(projectMenu(group, null, false, null, t), "projects.clearDirector")!;
    expect(clear.armed).toBe("projects.clearDirectorArmed(DIR)");
    expect(clear.danger).toBe(true);
    expect(clear.disabled).toBeFalsy();
    projectMutation.mockClear();
    await clear.onSelect();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledWith("local"));
    expect(projectMutation).toHaveBeenCalledWith("p1", { authorityEpoch: 1, projectRevision: 1 }, { kind: "clear_director" });
    // No Director: neither 清除 nor 轮换.
    const { useApp: app } = await import("../src/renderer/src/store");
    const snap = app.getState().sidebar!;
    app.setState({ sidebar: { ...snap, projects: { projects: [{ ...snap.projects!.projects[0]!, director_cutex_session_id: null }] } } as never, features: new Set(["project-optional-director", "owner-rotation"]) });
    const items = labels(projectMenu(group, null, false, null, t));
    expect(items).not.toContain("projects.clearDirector");
    expect(items).not.toContain("projects.rotation.menu");
  });

  it("清除主管 is disabled while a rotation runs; a refusal shows as a notice", async () => {
    const useApp = await seed(["project-optional-director", "owner-rotation"]);
    const { useRotations } = await import("../src/renderer/src/modules/projects/rotationStore");
    const { projectMenu } = await import("../src/renderer/src/lib/projectMenus");
    useRotations.setState({ byProject: { "local p1": { state: "handoff_requested" } as never } });
    const busy = find(projectMenu(group, null, false, null, t), "projects.clearDirector")!;
    expect(busy.disabled).toBe(true);
    expect(busy.title).toBe("projects.clearDirectorRotating");
    expect(find(projectMenu(group, null, false, null, t), "projects.rotation.menu")!.disabled).toBeFalsy();
    useRotations.setState({ byProject: { "local p1": { state: "done" } as never } });
    const notify = vi.fn();
    useApp.setState({ notify } as never);
    projectMutation.mockRejectedValueOnce(new Error("conflict: project_has_agent_operators"));
    await find(projectMenu(group, null, false, null, t), "projects.clearDirector")!.onSelect();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith("projects.clearDirectorFailed(conflict: project_has_agent_operators)"));
    useRotations.setState({ byProject: {} });
  });
});

describe("升级运行时 (claude-runtime-repin)", () => {
  // The menu is built synchronously: an agent never opened has no cached runtime view.
  const sora = (claudeRuntime?: { release: string; pendingRelease: string | null }) => ({
    ...session("sora"),
    runtime: { status: "online", activeTurnId: null, runtimeGeneration: 1, backend: "claude_subscription", ...(claudeRuntime ? { claudeRuntime } : {}) },
  }) as unknown as SessionResource;
  async function seedClaude(agent: SessionResource, selectedRelease?: string) {
    const { useApp } = await import("../src/renderer/src/store");
    useApp.setState({
      features: new Set(["claude-runtime-repin", "session-claude-runtime"]),
      sidebar: { active: [agent], retired: [], hostRows: {}, projects: null, ...(selectedRelease ? { claudeRuntime: { selectedRelease } } : {}) } as never,
    });
  }

  it("shows on the first right-click of a Claude agent never opened (from the agent list)", async () => {
    const agent = sora({ release: "claude-r17", pendingRelease: null });
    await seedClaude(agent, "claude-r19");
    const { agentMenu } = await import("../src/renderer/src/lib/menus");
    const item = find(agentMenu(agent, t, "local"), "menu.upgradeRuntime");
    expect(item?.hint).toBe("claude-r17 → claude-r19");
  });

  it("not when already on the selected release or the repin is pending", async () => {
    const { agentMenu } = await import("../src/renderer/src/lib/menus");
    const pending = sora({ release: "claude-r17", pendingRelease: "claude-r19" });
    await seedClaude(pending, "claude-r19");
    expect(find(agentMenu(pending, t, "local"), "menu.upgradeRuntime")).toBeUndefined();
    const current = sora({ release: "claude-r19", pendingRelease: null });
    await seedClaude(current, "claude-r19");
    expect(find(agentMenu(current, t, "local"), "menu.upgradeRuntime")).toBeUndefined();
  });
});

describe("agent menu additions", () => {
  it("copy submenu, open project, restart; fork only with session-fork", async () => {
    await seed();
    const { agentMenu } = await import("../src/renderer/src/lib/menus");
    const items = labels(agentMenu(session("a"), t, "local"));
    expect(items).toEqual(expect.arrayContaining(["menu.openProject", "menu.copy", "menu.restart"]));
    expect(items).not.toContain("menu.forkAgent");
    expect(items).not.toContain("menu.markRead");
    expect(labels(find(agentMenu(session("a"), t, "local"), "menu.copy")!.submenu!)).toEqual(["menu.copyName", "menu.copyCwd", "menu.copyId"]);
    await seed(["session-fork"]);
    expect(labels(agentMenu(session("a"), t, "local"))).toContain("menu.forkAgent");
    // Offline: no restart.
    expect(labels(agentMenu(session("a", { status: "offline" }), t, "local"))).not.toContain("menu.restart");
  });

  it("groups view-only actions apart from the runtime ones (owner 2026-10-16)", async () => {
    await seed(["session-fork"]);
    const unread = await import("../src/renderer/src/lib/turnUnread");
    unread.recordTurnEnd("a", { turnId: "t7", status: "completed" }, false);
    const { agentMenu } = await import("../src/renderer/src/lib/menus");
    const groups = labels(agentMenu(session("a"), t, "local")).join(" ").split(" | ").map((g) => g.split(" "));
    expect(groups).toEqual([
      ["menu.pin", "menu.markRead"],
      ["menu.openFiles", "menu.openProject", "menu.copy"],
      ["menu.rename", "menu.editInfo", "menu.forkAgent"],
      ["menu.stop", "menu.restart"],
      ["menu.archive"],
    ]);
    // No bookmark entry for an agent (pin instead).
    expect(groups.flat().some((l) => l.startsWith("bookmarks."))).toBe(false);
    find(agentMenu(session("a"), t, "local"), "menu.markRead")!.onSelect();
  });

  it("标为已读 with a turn mark", async () => {
    await seed();
    const unread = await import("../src/renderer/src/lib/turnUnread");
    unread.recordTurnEnd("a", { turnId: "t9", status: "failed" }, false);
    const { agentMenu } = await import("../src/renderer/src/lib/menus");
    find(agentMenu(session("a"), t, "local"), "menu.markRead")!.onSelect();
    expect("a" in unread.getTurnMarks()).toBe(false);
  });
});
