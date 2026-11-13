// Main-process facade (DaemonService, what IPC calls) with the real client and daemon-shaped project workspaces.
// The daemon lists a member holding the project's Operator grant only under agent_operators; owner lifecycle
// actions on it (archive / permanent retirement, Director-only blockers in the daemon) must still reach the daemon.
import { expect, it, vi } from "vitest";
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {} }));
import { CutexClient } from "@cutex-desktop/cutex-client";
import { DaemonService } from "../src/main/daemon";

const agent = (id: string, retired = false) => ({ agent: { cutex_session_id: id, spec: { name: id }, ...(retired ? { retired_at: "2026-11-12T00:00:00Z" } : {}) } });
const grantRow = (id: string, project = "p", grantee = id, retired = false) => ({ grant: { project_id: project, operator_cutex_session_id: grantee, grant_revision: 2, granted_at: "now", granted_by_primary_director_session: "director" }, member: agent(id, retired) });
const workspace = (agent_operators: unknown[], extra: Record<string, unknown> = {}) => ({ project_id: "p", authority_epoch: 3, project_revision: 9, lifecycle: "active",
  access_role: "human_management", director: { cutex_session_id: "director", member: agent("director") }, active_agents: [agent("plain")], retired_agents: [], archived_agents: [],
  operator_grant_revision: 2, agent_operators, ...extra });
const review = { cutex_session_id: "member", operation: "permanent_retire" };
function daemonWith(project: unknown, owner = true) {
  const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === "/v2/capabilities") return Response.json({ hostId: "canonical", featureList: ["agent-archive-kind-v1"], ...(owner ? {} : { user: { id: "u", isOwner: false, scope: "full" } }) });
    if (path.endsWith("/projects/p")) return Response.json(project);
    if (path.includes("/sessions/member")) return Response.json({ cutexSessionId: "member", lifecycle: "active", runtime: { status: "online", activeTurnId: null, runtimeGeneration: 4 } });
    return Response.json({ reviewed: true });
  });
  const daemon = new DaemonService(() => {});
  (daemon as any).client = new CutexClient({ baseUrl: "http://fixture.invalid", token: "synthetic" }, { fetch });
  const daemonCalls = () => fetch.mock.calls.map(([url]) => new URL(String(url)).pathname).filter(path => path !== "/v2/capabilities" && !path.endsWith("/projects/p"));
  return { daemon, daemonCalls };
}

it("retirement review of an Operator listed only under agent_operators reaches the daemon", async () => {
  const f = daemonWith(workspace([grantRow("member")]));
  expect(await f.daemon.delegationRetirementReview("p", review as never)).toEqual({ reviewed: true });
  expect(f.daemonCalls()).toHaveLength(1);
});
it.each([
  ["not in any list", workspace([])],
  ["grant names another agent", workspace([grantRow("member", "p", "someone-else")])],
  ["grant for another project", workspace([grantRow("member", "other")])],
  ["retired operator", workspace([grantRow("member", "p", "member", true)])],
])("retirement review refuses %s before any daemon review", async (_, project) => {
  const f = daemonWith(project);
  await expect(f.daemon.delegationRetirementReview("p", review as never)).rejects.toThrow("member_scope_changed");
  expect(f.daemonCalls()).toEqual([]);
});
it("retirement review stays owner-only", async () => {
  const f = daemonWith(workspace([grantRow("member")]), false);
  await expect(f.daemon.delegationRetirementReview("p", review as never)).rejects.toThrow("retirement_review_unavailable");
  expect(f.daemonCalls()).toEqual([]);
});
it("restart notice after a grant: the main facade records it for an operator-only member", async () => {
  const f = daemonWith(workspace([grantRow("member")]));
  expect(await f.daemon.operatorRuntimeNotice("p", "member")).toEqual({ state: "required" });
  const g = daemonWith(workspace([grantRow("member", "p", "someone-else")]));
  await expect(g.daemon.operatorRuntimeNotice("p", "member")).rejects.toThrow("operator_unavailable");
  expect(g.daemonCalls()).toEqual([]);
});
