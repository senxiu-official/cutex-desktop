// @vitest-environment jsdom
import { OPERATOR_ACTION_SCHEMA } from "@cutex-desktop/cutex-client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ api: null as unknown as { projectRead: ReturnType<typeof vi.fn>; operatorAction: ReturnType<typeof vi.fn>; operatorRuntimeNotice: ReturnType<typeof vi.fn> } }));
vi.mock("../bridge", async (original) => ({ ...(await original<object>()), apiFor: () => fx.api }));
vi.mock("../i18n", async (original) => ({
  ...(await original<object>()),
  translate: (key: string, vars?: Record<string, unknown>) => key + (vars ? JSON.stringify(vars) : ""),
}));

const { useApp } = await import("../store");
const { operatorMenuItem } = await import("./operatorMenu");
const { agentMenu } = await import("./menus");
const { normalizeEntries } = await import("./contextMenu");
const { RESTRICTED_FEATURE } = await import("../../../shared/users");

const t = ((key: string, vars?: Record<string, unknown>) => key + (vars ? JSON.stringify(vars) : "")) as never;
const session = (id: string, name = id) => ({ cutexSessionId: id, displayName: name, lifecycle: "active", runtime: { activeTurnId: null } });
const project = { project_id: "p1", authority_epoch: 3, director_cutex_session_id: "boss", operator_count: 1, lifecycle: "active", access_role: "human_management", active_member_count: 3, presentation: {} };

function seed(over: { operators?: Record<string, string[]> | undefined; project?: object; features?: Set<string> } = {}) {
  const operators = "operators" in over ? over.operators : { p1: ["deputy"] };
  useApp.setState({
    features: over.features ?? new Set<string>(),
    notify: vi.fn(),
    refreshHostSidebar: vi.fn(async () => {}),
    sidebar: {
      active: [session("boss", "Boss"), session("deputy", "Deputy"), session("member", "Member"), session("loner", "Loner")],
      retired: [],
      hostRows: { boss: { projectId: "p1" }, deputy: { projectId: "p1" }, member: { projectId: "p1" }, loner: { projectId: null } },
      projects: { schema: "x", projects: [{ ...project, ...over.project }] },
      ...(operators ? { projectOperators: operators } : {}),
    } as never,
  } as never);
}

function workspace(granted: string[]) {
  const agent = (id: string) => ({ agent: { cutex_session_id: id, retired_at: null } });
  return {
    project_id: "p1", access_role: "human_management", lifecycle: "active", authority_epoch: 3, director: { cutex_session_id: "boss" },
    active_agents: ["boss", "deputy", "member"].map(agent), operator_grant_revision: 7,
    agent_operators: granted.map((id) => ({ grant: { project_id: "p1", operator_cutex_session_id: id }, member: agent(id) })),
  };
}

beforeEach(() => {
  fx.api = {
    projectRead: vi.fn(async () => workspace(["deputy"])),
    operatorAction: vi.fn(async () => ({})),
    operatorRuntimeNotice: vi.fn(async () => ({ state: "offline" })),
  };
  seed();
});
afterEach(() => vi.clearAllMocks());

const labels = (id: string) => normalizeEntries(agentMenu(useApp.getState().sidebar!.active.find((s) => s.cutexSessionId === id)! as never, t, "local"))
  .flatMap((e) => (e === "separator" ? [] : [e.label]));

it("shows only for project members on hosts that report deputies, and only to the owner", () => {
  expect(operatorMenuItem("local", "member", t)?.label).toBe("projects.setOperator");
  expect(operatorMenuItem("local", "loner", t)).toBeNull();
  seed({ operators: undefined });
  expect(operatorMenuItem("local", "member", t)).toBeNull();
  seed({ features: new Set([RESTRICTED_FEATURE]) });
  expect(operatorMenuItem("local", "member", t)).toBeNull();
});

it("toggles the label and confirms in place only when granting", () => {
  const grant = operatorMenuItem("local", "member", t)!;
  expect(grant.label).toBe("projects.setOperator");
  expect(grant.armed).toBe('projects.operatorMenuArmed{"name":"Member"}');
  expect(grant.disabled).toBeFalsy();
  const revoke = operatorMenuItem("local", "deputy", t)!;
  expect(revoke.label).toBe("projects.revokeOperator");
  expect(revoke.armed).toBeUndefined();
});

it("is disabled with a reason for the Director and where the project page refuses", () => {
  const director = operatorMenuItem("local", "boss", t)!;
  expect(director.disabled).toBe(true);
  expect(director.title).toBe("projects.operatorMenuDirector");
  seed({ project: { lifecycle: "archived" } });
  expect(operatorMenuItem("local", "member", t)).toMatchObject({ disabled: true, title: "projects.operatorMenuUnavailable" });
  seed({ project: { director_cutex_session_id: null } });
  expect(operatorMenuItem("local", "member", t)).toMatchObject({ disabled: true, title: "projects.operatorMenuUnavailable" });
});

it("sits in the agent's menu (sidebar row, conversation header) for members only", () => {
  const member = labels("member");
  expect(member[member.indexOf("menu.editInfo") + 1]).toBe("projects.setOperator");
  expect(labels("deputy")).toContain("projects.revokeOperator");
  expect(labels("loner")).not.toContain("projects.setOperator");
});

it("sends the project page's operator action (setProjectOperator → operatorAction)", async () => {
  fx.api.projectRead.mockResolvedValueOnce(workspace([])).mockResolvedValue(workspace(["member"]));
  await operatorMenuItem("local", "member", t)!.onSelect();
  await vi.waitFor(() => expect(fx.api.operatorAction).toHaveBeenCalledTimes(1));
  expect(fx.api.operatorAction).toHaveBeenCalledWith(expect.objectContaining({
    schema: OPERATOR_ACTION_SCHEMA, project_id: "p1", expected_authority_epoch: 3, expected_grant_revision: 7,
    operation: "grant", operator_cutex_session_id: "member",
  }));
  await vi.waitFor(() => expect(useApp.getState().notify).toHaveBeenCalledWith("projects.operatorOffline"));

  fx.api.projectRead.mockResolvedValue(workspace(["deputy"]));
  await operatorMenuItem("local", "deputy", t)!.onSelect();
  await vi.waitFor(() => expect(fx.api.operatorAction).toHaveBeenLastCalledWith(expect.objectContaining({ operation: "revoke", operator_cutex_session_id: "deputy" })));
});

it("shows the daemon's error in a toast", async () => {
  fx.api.projectRead.mockResolvedValue(workspace([]));
  fx.api.operatorAction.mockRejectedValue(new Error("conflict: stale_grant_revision"));
  await operatorMenuItem("local", "member", t)!.onSelect();
  await vi.waitFor(() => expect(useApp.getState().notify).toHaveBeenCalledWith(
    'projects.operatorMenuFailed{"action":"projects.setOperator","error":"conflict: stale_grant_revision"}', "error"));
});

it("explains a refusal before any write (the project changed since the menu opened)", async () => {
  fx.api.projectRead.mockResolvedValue({ ...workspace([]), lifecycle: "archived" });
  await operatorMenuItem("local", "member", t)!.onSelect();
  await vi.waitFor(() => expect(useApp.getState().notify).toHaveBeenCalledWith(
    'projects.operatorMenuFailed{"action":"projects.setOperator","error":"projects.operatorMenuUnavailable"}', "error"));
  expect(fx.api.operatorAction).not.toHaveBeenCalled();
});
