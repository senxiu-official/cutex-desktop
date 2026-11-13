import { expect, it, vi } from "vitest";
import { CutexClient } from "@cutex-desktop/cutex-client";
import { readDelegationUpgrade } from "../src/shared/delegationUpgradeAdapter";

// reviewerGrantState is pure over the snapshot; keep the renderer store/bridge out of a node test.
vi.mock("../src/renderer/src/store", () => ({ useApp: Object.assign(() => undefined, { getState: () => ({}) }), featuresOf: () => new Set<string>() }));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { on: () => () => undefined } }));
vi.mock("../src/renderer/src/lib/hostLists", () => ({ hostApi: vi.fn() }));
vi.mock("../src/renderer/src/lib/delegationStore", () => ({ refreshOpenDelegations: vi.fn(), refreshDelegation: vi.fn() }));
import { reviewerGrantState } from "../src/renderer/src/modules/delegations/reviewerGrant";

// Private fixture of route #d3fd12: approved routing approval, pendingReview own-root ask, and one side of the
// route holding the project's Agent Operator grant (daemon lists it under agent_operators, not active_agents).
const HOST = "server-canonical";
const ref = (id: string) => ({ hostId: HOST, id });
const owner = { kind: "owner", hostId: null, sessionId: null, name: null, redacted: false };
const policy = { projectId: "project", revision: 7, memberMode: "approvalRequired", updatedBy: null, updatedAt: null, allowedActions: { update: true } };
const approved = {
  id: "approval", projectId: "project", delegationRef: ref("ask"), requestDigest: `sha256:${"a".repeat(64)}`, policyRevision: 7, authorityEpoch: 2,
  revision: 2, state: "approved", requestedBy: { kind: "agent", hostId: HOST, sessionId: "illust", name: "ILLUST", redacted: false },
  decidedBy: owner, decisionAuthority: "owner", decisionNote: null, createdAt: "2026-11-12T05:39:53Z", decidedAt: "2026-11-12T05:40:09Z",
  allowedActions: { approve: false, deny: false },
};
const node = {
  kind: "delegation", id: "ask", hostId: HOST, ref: ref("ask"), projectId: "project", parent: null, parentState: "none", redactedParentRef: null,
  root: ref("ask"), rootState: "visible", redactedRootRef: null, followUp: null, followUpState: "none", parentId: null, rootId: "ask",
  followUpOf: null, parentAttemptId: null, lineageState: "verified", redactedParent: false,
  requester: { ...ref("illust"), name: "ILLUST" }, target: { ...ref("ui"), name: "UI" }, title: "Wire assets", execution: "pendingReview",
  closed: null, lastActivityAt: "2026-11-12T05:39:53Z", resumeEvidence: { kind: "none" }, continuation: null, routingApproval: approved,
  allowedActions: { readAttempts: true, stop: true, stopSelf: false, stopJobs: false, declareContinuation: false, resumeContinuation: false }, revision: 3,
};
const member = (id: string, extra: Record<string, unknown> = {}) => ({ agent: { cutex_session_id: id, spec: { name: id.toUpperCase() }, ...extra } });
const operator = (id: string, project = "project", extra: Record<string, unknown> = {}) =>
  ({ grant: { project_id: project, operator_cutex_session_id: id }, member: member(id, extra) });

async function snapshot(workspace: unknown) {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const p = new URL(String(input)).pathname;
    if (p === "/v2/capabilities") return Response.json({ hostId: HOST, featureList: ["delegation-routing-v1", "delegation-tree-stop-v1"] });
    return Response.json(p.endsWith("/projects/project") ? workspace
      : p.endsWith("/delegations") ? { nodes: [node], revision: "tree", nextCursor: null, coverage: "complete", unresolvedEdges: [] }
      : p.endsWith("delegation-policy") ? policy
      : p.endsWith("delegation-grants") ? { grants: [], allowedActions: { create: true } }
      : { routingApprovals: [approved] });
  });
  return readDelegationUpgrade(new CutexClient({ baseUrl: "http://fixture.invalid", token: "synthetic" }, { fetch, sleep: async () => {} }), "project");
}
const state = async (workspace: unknown) => reviewerGrantState(await snapshot(workspace) as never, approved as never);

it.each(["target", "requester"] as const)("approved route with only the %s an Agent Operator offers the one-use reviewer grant", async who => {
  const [op, active] = who === "target" ? ["ui", "illust"] : ["illust", "ui"];
  expect(await state({ active_agents: [member(active)], retired_agents: [], agent_operators: [operator(op)] })).toMatchObject({
    kind: "needed", scope: { intent: { kind: "grant", requesterRef: ref("illust"), targetRefs: [ref("ui")], rootDelegationRef: ref("ask"), maxUses: 1 } },
  });
});
it.each([
  ["missing", []],
  ["retired", [operator("ui", "project", { retired_at: "2026-11-12T00:00:00Z" })]],
  ["other project", [operator("ui", "other-project")]],
  ["grant for another agent", [{ ...operator("ui"), grant: { project_id: "project", operator_cutex_session_id: "someone-else" } }]],
])("%s operator is not a party and the grant stays unavailable", async (_, agent_operators) => {
  expect(await state({ active_agents: [member("illust")], retired_agents: [], agent_operators })).toEqual({ kind: "unavailable" });
});
