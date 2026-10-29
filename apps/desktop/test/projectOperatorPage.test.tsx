// @vitest-environment jsdom
import { act, createElement as h, createContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MemberControls } from "../src/renderer/src/components/AgentList";
import type { AgentRow } from "../src/renderer/src/lib/sidebar";
import type { MenuAction } from "../src/renderer/src/lib/contextMenu";

const fx = vi.hoisted(() => ({
  state: {} as Record<string, any>, sidebar: null as any, model: null as any, scope: null as any, prefs: { projectIcons: {}, projectRemarks: {} },
  view: null as any, read: vi.fn(), set: vi.fn(), refresh: vi.fn(), controls: undefined as MemberControls | undefined,
  tabs: [{ tab: "overview", titleKey: "projects.tab.overview", entry: null }, { tab: "agents", titleKey: "projects.tab.agents", entry: null }],
  api: null as any,
}));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/store", () => ({ useApp: Object.assign((select: (s: any) => unknown) => select(fx.state), { getState: () => fx.state }), sidebarOf: () => fx.sidebar }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: { on: () => () => {} }, onEvent: () => () => {} }));
vi.mock("../src/renderer/src/lib/targetHost", () => ({
  TargetHostContext: createContext(null), useTargetHostId: () => "remote", useTargetIsFocus: () => false, useTargetIsRemote: () => true,
  useTargetApi: () => fx.api, useTargetFeatures: () => fx.state.features, useTargetSidebar: () => fx.sidebar,
}));
vi.mock("../src/renderer/src/lib/useHostScope", () => ({ useHostScope: () => fx.scope, useHostData: () => ({ services: [] }) }));
vi.mock("../src/renderer/src/lib/sidebarView", () => ({ useSidebarModel: () => fx.model }));
vi.mock("../src/renderer/src/lib/projectTabsView", () => ({ useProjectTabs: () => fx.tabs }));
vi.mock("../src/renderer/src/lib/prefs", () => ({ useUiPrefs: () => fx.prefs, setProjectIcon: vi.fn() }));
vi.mock("../src/renderer/src/lib/projectOperators", () => ({
  operatorSupported: (view: any) => !!view && Array.isArray(view.agent_operators) && Number.isSafeInteger(view.operator_grant_revision),
  operatorIds: (view: any) => new Set<string>(view?.agent_operators ?? []), setProjectOperator: fx.set,
}));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { ui: {} } }));
vi.mock("../src/renderer/src/modules/projects/projectNav", () => ({ openProject: vi.fn() }));
vi.mock("../src/renderer/src/modules/projects/rotationStore", () => ({ useProjectRotation: () => null, loadProjectRotation: vi.fn() }));
vi.mock("../src/renderer/src/lib/projectMenus", () => ({ editProjectRemark: vi.fn() }));
vi.mock("../src/renderer/src/lib/projectArchive", () => ({ archiveProject: vi.fn(), confirmProjectArchive: vi.fn() }));
vi.mock("../src/renderer/src/lib/remoteMode", () => ({ pickDirectory: vi.fn(), useFolderPickBlocked: () => false }));
vi.mock("../src/renderer/src/lib/useCreateHost", () => ({ useCreateHost: () => ({}), rememberCreateHost: vi.fn() }));
vi.mock("../src/renderer/src/components/settings/SecuritySettings", () => ({ ExternalAgentsSection: () => null }));
vi.mock("../src/renderer/src/components/Sidebar", () => ({ OfflineSection: ({ rows }: { rows: AgentRow[] }) => h("div", null, rows.map((row) => h("span", { key: row.id, "data-agent-id": row.id }, row.name))) }));
vi.mock("../src/renderer/src/components/AgentRows", () => ({ AgentRowButton: ({ row }: { row: AgentRow }) => h("span", { "data-agent-id": row.id }, row.name) }));
vi.mock("../src/renderer/src/components/AgentList", () => ({ AgentList: ({ members }: { members?: MemberControls }) => { fx.controls = members; return h("div", { "data-agent-list": "" }); } }));
vi.mock("../src/renderer/src/components/DelegationList", () => ({ DelegationList: () => null }));
vi.mock("../src/renderer/src/components/ProjectMemory", () => ({ ProjectMemoryList: () => null }));
vi.mock("../src/renderer/src/components/ServiceLine", () => ({ ServiceLine: () => null }));
vi.mock("../src/renderer/src/components/Page", () => ({ PageBody: ({ children }: { children: React.ReactNode }) => h("div", null, children), SubNav: ({ children }: { children: React.ReactNode }) => h("nav", null, children), SUBNAV_ITEM: "", SUBNAV_ON: "", SUBNAV_OFF: "" }));
vi.mock("../src/renderer/src/components/settings/Form", () => ({ Button: () => null, SettingRow: () => null, Section: () => null, Select: () => null, TextInput: () => null }));
vi.mock("../src/renderer/src/components/ProjectColorPicker", () => ({ ProjectColorPicker: () => null }));
vi.mock("../src/renderer/src/components/ProjectBadge", () => ({ ProjectBadge: () => null }));
vi.mock("../src/renderer/src/components/ProjectIconPicker", () => ({ ProjectIconPicker: () => null }));
vi.mock("../src/renderer/src/components/HostPicker", () => ({ HostPicker: () => null }));
vi.mock("../src/renderer/src/components/HostMark", () => ({ HostMark: () => null }));
vi.mock("../src/renderer/src/modules/Outlet", () => ({ ItemBoundary: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("../src/renderer/src/modules/projects/DirectorRotationDialog", () => ({ DirectorRotationDialog: () => null }));
vi.mock("../src/renderer/src/modules/projects/MemberPicker", () => ({ MemberPicker: () => null }));
vi.mock("../src/renderer/src/modules/projects/ProjectRootEditor", () => ({ ProjectRootEditor: () => null }));
import { ProjectsPage } from "../src/renderer/src/modules/projects/ProjectsPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
const row = (id: string, retired = false) => ({ id, name: id, status: "idle", session: { cutexSessionId: id, displayName: id, lifecycle: retired ? "retired" : "active", runtime: { online: true } } }) as unknown as AgentRow;
beforeEach(() => {
  const project = { project_id: "p", authority_epoch: 1, project_revision: 1, director_cutex_session_id: "director", presentation: { display_name: "Project", badge_label: "P", color: "cyan" }, active_member_count: 3 };
  const online = [row("director"), row("operator"), row("member")];
  fx.sidebar = { active: online.map((r) => r.session), retired: [], hostRows: Object.fromEntries(online.map((r) => [r.id, { projectId: "p" }])), projects: { projects: [project] }, projectOperators: { p: ["director", "operator", "nonmember"] } };
  fx.model = { groups: [{ kind: "project", id: "p", online, offline: [] }] };
  fx.scope = { focus: "local", hostsInScope: [{ id: "remote" }], showHostMarks: false, host: () => null };
  fx.state = { features: new Set(), sidebar: fx.sidebar, hosts: { active: "local" }, byHost: {}, refreshHostSidebar: fx.refresh };
  fx.view = { project_id: "p", authority_epoch: 1, director: { cutex_session_id: "director" }, lifecycle: "active", access_role: "human_management", operator_grant_revision: 2, agent_operators: ["director", "operator", "nonmember"] };
  fx.read.mockReset().mockImplementation(async () => fx.view); fx.set.mockReset().mockResolvedValue(undefined); fx.refresh.mockReset(); fx.controls = undefined;
  fx.api = { projectRead: fx.read, projectMemory: vi.fn().mockResolvedValue(null), projectMcp: vi.fn().mockResolvedValue(null) };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const mount = async (tab = "overview") => { await act(async () => root.render(h(ProjectsPage, { params: { project: "p", host: "remote", tab } }))); };
const operatorItem = (id: string) => fx.controls?.rowMenu(row(id)).find((item): item is MenuAction => !!item && typeof item === "object" && (item.label === "projects.setOperator" || item.label === "projects.revokeOperator"));

it("groups active Operators separately without duplicating the Director or including nonmembers", async () => {
  await mount();
  expect([...host.querySelectorAll('[data-project-role="operator"] [data-agent-id]')].map((el) => el.getAttribute("data-agent-id"))).toEqual(["operator"]);
  expect(host.querySelectorAll('[data-agent-id="director"]')).toHaveLength(1);
  expect(host.querySelector('[data-project-role="director"] [data-agent-id="director"]')).not.toBeNull();
  expect(host.querySelector('[data-project-role="member"] [data-agent-id="member"]')).not.toBeNull();
});

it("offers grant/revoke only for active non-Directors and calls the action on the project's host then refetches", async () => {
  await mount("agents");
  expect(operatorItem("director")).toBeUndefined(); expect(operatorItem("nonmember")).toBeUndefined();
  const revoke = operatorItem("operator")!; const grant = operatorItem("member")!;
  expect("label" in revoke && revoke.label).toBe("projects.revokeOperator");
  expect("label" in grant && grant.label).toBe("projects.setOperator");
  await act(async () => { if ("onSelect" in grant) grant.onSelect?.(); });
  expect(fx.set).toHaveBeenCalledExactlyOnceWith("remote", "p", "member", true);
  expect(fx.read).toHaveBeenCalledTimes(2);
});

it.each(["primary_director", "agent_operator", "full", undefined])("does not offer owner Operator actions for workspace access %s", async (role) => {
  fx.view.access_role = role; await mount("agents"); expect(operatorItem("member")).toBeUndefined();
});

it("hides actions for a restricted connection even when workspace claims human management", async () => {
  fx.state.features = new Set(["desktop:restricted"]); await mount("agents"); expect(operatorItem("member")).toBeUndefined();
});

it("keeps older hosts without the projection unchanged", async () => {
  delete fx.view.agent_operators; delete fx.view.operator_grant_revision;
  await mount(); expect(host.querySelector("[data-project-role]")).toBeNull();
  await mount("agents"); expect(operatorItem("member")).toBeUndefined();
});

it("rejects a workspace response for a different project", async () => {
  fx.view.project_id = "other"; await mount("agents"); expect(operatorItem("member")).toBeUndefined();
});

it("ignores an older workspace read after the projected Operator roster changes", async () => {
  let reply!: (view: unknown) => void;
  fx.read.mockReturnValueOnce(new Promise((resolve) => { reply = resolve; }));
  await mount("agents"); expect(operatorItem("member")).toBeUndefined();
  fx.view = { ...fx.view, agent_operators: [] };
  fx.sidebar = { ...fx.sidebar, projectOperators: { p: [] } }; fx.state.sidebar = fx.sidebar;
  await mount("agents");
  await act(async () => reply({ ...fx.view, agent_operators: ["member"] }));
  const item = operatorItem("member")!;
  expect("label" in item && item.label).toBe("projects.setOperator");
});

it("keeps the roster and reports a failed owner mutation", async () => {
  fx.set.mockRejectedValue(new Error("revision conflict")); await mount("agents");
  const item = operatorItem("member")!;
  await act(async () => { if ("onSelect" in item) item.onSelect?.(); });
  expect(host.textContent).toContain("revision conflict");
  expect(fx.read).toHaveBeenCalledTimes(2);
  expect(operatorItem("member")).toBeDefined();
});

it.each(["archived", "no-director", "new-authority"])("hides actions when the canonical project cannot grant an Operator: %s", async (state) => {
  if (state === "archived") fx.view.lifecycle = "archived";
  if (state === "no-director") fx.view.director = null;
  if (state === "new-authority") fx.view.authority_epoch++;
  await mount("agents"); expect(operatorItem("member")).toBeUndefined();
});

it("explains that an Operator must be revoked before becoming Director, without rotating", async () => {
  fx.state.features.add("owner-rotation");
  fx.api.projectMutation = vi.fn();
  await mount("agents");
  const item = fx.controls!.rowMenu(row("operator")).find(entry => !!entry && typeof entry === "object" && "label" in entry && entry.label === "projects.setDirector") as MenuAction;
  expect(item).toBeDefined();
  await act(async () => { item.onSelect?.(); await Promise.resolve(); await Promise.resolve(); });
  expect(host.textContent).toContain("projects.operatorSuccessor");
  expect(fx.api.projectMutation).not.toHaveBeenCalled();
});
