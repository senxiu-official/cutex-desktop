import { expect, it, vi } from "vitest";
import type { OperatorProjectWorkspace } from "@cutex-desktop/cutex-client";
vi.mock("../src/renderer/src/bridge", () => ({ apiFor: vi.fn() }));
vi.mock("../src/renderer/src/i18n", () => ({ translate: (key: string) => key }));
vi.mock("../src/renderer/src/store", () => ({ useApp: { getState: vi.fn() }, featuresOf: vi.fn() }));
vi.mock("../src/renderer/src/lib/hostSwitch", () => ({ captureHostAction: () => () => true }));
import { changeProjectOperator, operatorIds, operatorSupported } from "../src/renderer/src/lib/projectOperators";

const member = (id: string) => ({ agent: { cutex_session_id: id, spec: { name: id } }, lifecycle: "active" });
function workspace(): OperatorProjectWorkspace {
  return { project_id: "p", authority_epoch: 3, project_revision: 99, access_role: "human_management", lifecycle: "active", director: { cutex_session_id: "director" },
    operator_grant_revision: 7, agent_operators: [], presentation: { display_name: "P", badge_label: "P", color: "blue" }, active_agents: [member("director"), member("member")], retired_agents: [] };
}
function setup() {
  const view = workspace();
  return { view, api: { projectRead: vi.fn(async () => view), operatorAction: vi.fn(async () => ({} as never)) }, projectId: "p", sessionId: "member", grant: true,
    current: vi.fn(() => true), owner: vi.fn(() => true), refresh: vi.fn(async () => {}), runtimeNotice: vi.fn(async () => {}) };
}
it("uses fresh authority and Operator grant CAS, then refreshes and records a launch-tool notice", async () => {
  const f = setup(); await changeProjectOperator(f);
  expect(f.api.operatorAction).toHaveBeenCalledWith(expect.objectContaining({ project_id: "p", operation: "grant", expected_authority_epoch: 3, expected_grant_revision: 7, operator_cutex_session_id: "member" }));
  expect(f.api.projectRead).toHaveBeenCalledTimes(2); expect(f.refresh).toHaveBeenCalledOnce(); expect(f.runtimeNotice).toHaveBeenCalledOnce();
  expect(f.runtimeNotice.mock.invocationCallOrder[0]!).toBeGreaterThan(f.api.operatorAction.mock.invocationCallOrder[0]!);
});
it("uses the same canonical grant revision to revoke", async () => {
  const f = setup(); f.grant = false;
  f.view.agent_operators = [{ grant: { project_id: "p", operator_cutex_session_id: "member", grant_revision: 6, granted_at: "now", granted_by_primary_director_session: "director" }, member: member("member") }];
  await changeProjectOperator(f);
  expect(f.api.operatorAction).toHaveBeenCalledWith(expect.objectContaining({ operation: "revoke", expected_grant_revision: 7 }));
});
it("refreshes on generic HTTP409 conflict without retrying or recording runtime notices", async () => {
  const f = setup(); f.api.operatorAction.mockRejectedValue(Error("conflict: operator_grant_revision_conflict"));
  await expect(changeProjectOperator(f)).rejects.toThrow("conflict");
  expect(f.api.operatorAction).toHaveBeenCalledOnce(); expect(f.api.projectRead).toHaveBeenCalledTimes(2); expect(f.refresh).toHaveBeenCalledOnce(); expect(f.runtimeNotice).not.toHaveBeenCalled();
});
it("does not let a failed sidebar refresh skip the notice after a successful role change", async () => {
  const f = setup(); f.refresh.mockRejectedValue(Error("offline"));
  await changeProjectOperator(f); expect(f.runtimeNotice).toHaveBeenCalledOnce();
});
it.each(["old", "viewer", "director", "inactive", "wrong-project", "no-director", "retired", "epoch"])("rejects %s evidence before any write", async reason => {
  const f = setup();
  if (reason === "old") delete f.view.operator_grant_revision;
  if (reason === "viewer") f.view.access_role = "agent_operator";
  if (reason === "director") f.sessionId = "director";
  if (reason === "inactive") f.view.lifecycle = "archived";
  if (reason === "wrong-project") f.view.project_id = "other";
  if (reason === "no-director") f.view.director = null;
  if (reason === "retired") f.view.active_agents = [];
  if (reason === "epoch") f.view.authority_epoch = NaN;
  await expect(changeProjectOperator(f)).rejects.toThrow("operator_unavailable"); expect(f.api.operatorAction).not.toHaveBeenCalled();
});
it("never requests from a non-owner, and drops stale read completions", async () => {
  const f = setup(); f.owner.mockReturnValue(false);
  await expect(changeProjectOperator(f)).rejects.toThrow(); expect(f.api.projectRead).not.toHaveBeenCalled();
  f.owner.mockReturnValue(true); f.current.mockReturnValueOnce(true).mockReturnValue(false);
  await expect(changeProjectOperator(f)).rejects.toThrow(); expect(f.api.operatorAction).not.toHaveBeenCalled();
});
it("does not mutate or restart for an already matching role", async () => {
  const f = setup(); f.grant = false; await changeProjectOperator(f);
  expect(f.api.operatorAction).not.toHaveBeenCalled(); expect(f.runtimeNotice).not.toHaveBeenCalled(); expect(f.refresh).toHaveBeenCalledOnce();
});
it("old projections are unsupported, and a Director or mismatched grant cannot enter the role set", () => {
  expect(operatorSupported(null)).toBe(false); expect(operatorIds(undefined).size).toBe(0);
  const view = workspace(); view.agent_operators = ["director", "member"].map(id => ({ grant: { project_id: "p", operator_cutex_session_id: id, grant_revision: 1, granted_at: "now", granted_by_primary_director_session: "director" }, member: member(id) }));
  expect([...operatorIds(view)]).toEqual(["member"]);
  view.agent_operators[1]!.member = member("other"); expect(operatorIds(view).size).toBe(0);
});

// The daemon lists an Operator only under agent_operators (never active_agents); revoke must still reach it.
const operatorGrant = (id: string, project = "p", grantee = id) => ({ grant: { project_id: project, operator_cutex_session_id: grantee, grant_revision: 6, granted_at: "now", granted_by_primary_director_session: "director" }, member: member(id) });
function operatorOnly(row = operatorGrant("member")) {
  const f = setup(); f.grant = false; f.view.active_agents = []; f.view.agent_operators = [row]; return f;
}
it("revokes an Operator listed only under agent_operators", async () => {
  const f = operatorOnly(); await changeProjectOperator(f);
  expect(f.api.operatorAction).toHaveBeenCalledWith(expect.objectContaining({ operation: "revoke", operator_cutex_session_id: "member", expected_authority_epoch: 3, expected_grant_revision: 7 }));
  expect(f.runtimeNotice).toHaveBeenCalledOnce();
});
it("granting an agent already listed only as Operator is a no-op refresh", async () => {
  const f = operatorOnly(); f.grant = true; await changeProjectOperator(f);
  expect(f.api.operatorAction).not.toHaveBeenCalled(); expect(f.refresh).toHaveBeenCalledOnce();
});
it.each([
  ["mismatched grantee", { ...operatorGrant("member", "p", "someone-else") }],
  ["retired", { ...operatorGrant("member"), member: { ...member("member"), agent: { ...member("member").agent, retired_at: "2026-11-12T00:00:00Z" } } }],
  ["other project", operatorGrant("member", "other")],
  ["Director row", { ...operatorGrant("director") }],
])("operator-only %s is not a member: no write", async (reason, row) => {
  const f = operatorOnly(row as never); if (reason === "Director row") f.sessionId = "director";
  await expect(changeProjectOperator(f)).rejects.toThrow("operator_unavailable"); expect(f.api.operatorAction).not.toHaveBeenCalled();
});
