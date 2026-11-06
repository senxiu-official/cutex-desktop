// Sidebar project / agent menus: the project menu's items (open, create, bulk, display prefs, copy,
// Director), 「在线空闲不收起」 as a host-keyed pref, and the agent menu's additions.
import { translate } from "../src/renderer/src/i18n";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import { normalizeEntries, type MenuAction, type MenuEntry } from "../src/renderer/src/lib/contextMenu";

function staticSubmenu(entries: MenuAction["submenu"]): MenuEntry[] {
  expect(Array.isArray(entries)).toBe(true);
  if (!Array.isArray(entries)) throw new Error("Expected a static submenu fixture");
  return entries;
}
import type { AgentRow, ProjectGroup, SidebarGroup } from "../src/renderer/src/lib/sidebar";

const projectMutation = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({}));
vi.mock("../src/renderer/src/bridge", () => ({ api: { projectMutation: (...args: unknown[]) => projectMutation(...args) }, onEvent: () => () => {}, bridge: { on: () => () => {} }, cleanIpcMessage: (m: string) => m }));

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
      "menu.moveToSection",
      "|",
      "menu.copy",
      "menu.renameProject",
      "remark.menu",
      "projects.addMember…",
      // Last, after a separator: 在主界面调整 (lead 2026-10-18), then 侧栏设置… (design 006 v1).
      "|",
      "customize.sidebar.menu",
      translate("settings.panel.menu.sidebar"),
      // 「使用小指南」 (lib/panelGuides).
      "|",
      translate("onboarding.panel.menu"),
    ]);
    const open = find(projectMenu(group, "/w", false, null, t), "menu.openProjectPage")!;
    expect(labels(staticSubmenu(open.submenu))).toEqual(["projects.tab.overview", "projects.tab.agents", "projects.tab.tasks", "projects.tab.memory", "projects.tab.settings"]);
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

  it("no 「在线空闲不收起」 any more (design 060 B: 其余 is folded per group in the sidebar)", async () => {
    await seed();
    const { projectMenu } = await import("../src/renderer/src/lib/projectMenus");
    expect(find(projectMenu(group, null, false, null, t), "menu.sidebarDisplay")).toBeUndefined();
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
  it("keeps pin/unpin reachable for live and offline agents; no second 在旁边打开 next to the module's 并排打开", async () => {
    const app = await seed();
    const { agentMenu } = await import("../src/renderer/src/lib/menus");
    for (const status of ["online", "offline"]) {
      const entries = agentMenu(session("a", { status }), t, "local");
      expect(find(entries, "pane.openBeside")).toBeUndefined();
      expect(find(entries, "menu.pin")).toBeDefined();
    }
    app.setState({ pinned: new Set(["a"]) });
    expect(find(agentMenu(session("a"), t, "local"), "menu.unpin")).toBeDefined();
    app.setState({ pinned: new Set() });
  });

  it("并排打开 (the conversation module's agent ref action) routes through the existing beside effect", async () => {
    await seed();
    const effects = await import("../src/renderer/src/lib/workspaceEffects");
    const { default: conversation } = await import("../src/renderer/src/modules/conversation/index");
    const action = (conversation.contributes?.["ref.action"] ?? []).find((a) => a.id === "conversation.openAgentSide")!;
    expect(action.titleKey).toBe("conversation.agent.openSide");
    const run = vi.fn();
    const effect = vi.spyOn(effects, "agentEffect").mockReturnValue({ run } as never);
    try {
      await action.run({ hostId: "local", kind: "agent", key: "a", title: "A", params: { sessionId: "a" } });
      expect(effect).toHaveBeenLastCalledWith({ hostId: "local", key: "a", title: "A" }, "beside");
      expect(run).toHaveBeenCalledTimes(1);
    } finally { effect.mockRestore(); }
    // A cold import of the whole conversation module.
  }, 30_000);
  it("offers an explicit restart for changed Operator tools and warns about any active turn", async () => {
    await seed();
    const { useApp } = await import("../src/renderer/src/store");
    const { agentMenu } = await import("../src/renderer/src/lib/menus");
    const sidebar = useApp.getState().sidebar!;
    useApp.setState({ sidebar: { ...sidebar, operatorRestartRequired: ["a"] } });
    const action = find(agentMenu(session("a"), t, "local"), "projects.operatorRestartNow");
    expect(action?.armed).toBe("projects.operatorRestartArmed");
    expect(labels(agentMenu(session("a", { status: "offline" }), t, "local"))).not.toContain("projects.operatorRestartNow");
  });
  it("copy submenu, open project, restart; fork only with session-fork", async () => {
    await seed();
    const { agentMenu } = await import("../src/renderer/src/lib/menus");
    const items = labels(agentMenu(session("a"), t, "local"));
    expect(items).toEqual(expect.arrayContaining(["menu.open", "menu.copy", "menu.restart"]));
    expect(labels(staticSubmenu(find(agentMenu(session("a"), t, "local"), "menu.open")!.submenu))).toEqual(["menu.openFiles", "menu.openProject"]);
    expect(items).not.toContain("menu.forkAgent");
    expect(items).not.toContain("menu.markRead");
    expect(labels(staticSubmenu(find(agentMenu(session("a"), t, "local"), "menu.copy")!.submenu))).toEqual(["menu.copyName", "menu.copyCwd", "menu.copyId"]);
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
      ["menu.open", "menu.copy"],
      ["menu.editInfo", "menu.forkAgent"],
      ["menu.stop", "menu.restart"],
      ["menu.archive"],
    ]);
    // No bookmark entry for an agent (pin instead).
    expect(groups.flat().some((l) => l.startsWith("bookmarks."))).toBe(false);
    find(agentMenu(session("a"), t, "local"), "menu.markRead")!.onSelect();
  });

  it("编辑信息… holds the display name (显示名称 folded in); /rename keeps its own dialog texts", async () => {
    await seed();
    const dialogs = await import("../src/renderer/src/lib/contextMenu");
    const info = vi.spyOn(dialogs, "agentInfoDialog").mockResolvedValue(null);
    const prompt = vi.spyOn(dialogs, "promptDialog").mockResolvedValue(null);
    const { agentMenu, renameAgent } = await import("../src/renderer/src/lib/menus");
    try {
      const named = { ...session("a"), displayName: "Shown", displayNameOverride: "Shown", formalAgentName: "formal-a" } as SessionResource;
      const menu = agentMenu(named, t, "local");
      expect(find(menu, "menu.displayName")).toBeUndefined();
      expect(find(menu, "menu.rename")).toBeUndefined();
      await find(menu, "menu.editInfo")!.onSelect();
      await vi.waitFor(() => expect(info).toHaveBeenCalled());
      expect((info.mock.calls.at(-1) as unknown[])[4]).toMatchObject({ realName: "formal-a", ownName: "formal-a" });
      // /rename without a value: the same words, now as the prompt's hint.
      await renameAgent(named, t, undefined, "local");
      expect(prompt).toHaveBeenLastCalledWith("menu.displayName", "Shown", { placeholder: "formal-a", hint: "menu.displayNameHint(formal-a)" });
      await renameAgent(session("b"), t, undefined, "local");
      expect(prompt).toHaveBeenLastCalledWith("menu.displayName", "B", { placeholder: undefined, hint: "menu.displayNameHintNoFormal" });
    } finally { info.mockRestore(); prompt.mockRestore(); }
  });

  it("设置 › holds the Claude tool switches (flat, under a note); 分叉… only when a Profile is chosen first", async () => {
    await seed(["session-fork"]);
    const { agentMenu } = await import("../src/renderer/src/lib/menus");
    const claude = { ...session("a"), runtimeDefaults: { claudeAllowWrite: false, claudeAllowExec: true } } as unknown as SessionResource;
    const menu = agentMenu(claude, t, "local");
    expect(find(menu, "menu.claudeTools")).toBeUndefined();
    const inside = staticSubmenu(find(menu, "menu.agentSettings")!.submenu).filter((e): e is MenuAction => !!e && e !== "separator");
    expect(inside.map((e) => [e.label, e.hint ?? null, !!e.note])).toEqual([["menu.claudeTools", null, true], ["menu.claudeWrite", "menu.off", false], ["menu.claudeExec", "menu.on", false]]);
    expect(inside.some((e) => e.submenu)).toBe(false);
    // Not a Claude agent: nothing to hold, no 设置 row.
    expect(find(agentMenu(session("a"), t, "local"), "menu.agentSettings")).toBeUndefined();
    expect(find(agentMenu(session("a"), t, "local"), "menu.forkAgent")).toBeDefined();
    await seed(["session-fork", "session-fork-profile"]);
    expect(find(agentMenu(session("a"), t, "local"), "menu.forkAgent…")).toBeDefined();
  });

  it("暂停 / 只停收新委托 are worded apart and grouped away from view and runtime rows", async () => {
    await seed(["asks-pause-v2", "agent-pause"]);
    const { agentMenu } = await import("../src/renderer/src/lib/menus");
    const groups = labels(agentMenu(session("a"), t, "local")).join(" ").split(" | ").map((g) => g.split(" "));
    const pause = groups.find((g) => g.includes("menu.asksPause"))!;
    expect(pause).toEqual(["agentPause.pause", "menu.asksPause"]);
    // Notes live in the info mark, never in the label or a hover title.
    const row = find(agentMenu(session("a"), t, "local"), "menu.asksPause")!;
    expect([row.info, row.title]).toEqual(["menu.asksPauseHint", undefined]);
    const pauseRow = find(agentMenu(session("a"), t, "local"), "agentPause.pause")!;
    expect([pauseRow.info, pauseRow.title]).toEqual(["agentPause.pauseHint", undefined]);
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
