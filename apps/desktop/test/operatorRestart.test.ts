import { expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import { OperatorRestartNotices, recordOperatorRuntimeNotice } from "../src/main/operatorRestart";

const session = (busy = false, generation = 8) => ({ cutexSessionId: "member", lifecycle: "active", runtime: { status: "online", activeTurnId: busy ? "turn" : null, runtimeGeneration: generation } }) as SessionResource;
function setup(busy = false) {
  const resource = session(busy), notices = new OperatorRestartNotices();
  return { resource, notices, read: vi.fn(async () => resource), current: vi.fn(() => true) };
}
it.each([false, true])("only records a notice for an online runtime, busy=%s", async busy => {
  const f = setup(busy); expect(await recordOperatorRuntimeNotice(f)).toEqual({ state: "required" });
  expect(f.read).toHaveBeenCalledOnce(); expect(f.notices.current([f.resource])).toEqual(["member"]);
  expect(f.resource.runtime.status).toBe("online"); expect(f.resource.runtime.activeTurnId).toBe(busy ? "turn" : null);
});
it("does not record a notice after the host changes during the read", async () => {
  const f = setup(); f.current.mockReturnValue(false);
  await expect(recordOperatorRuntimeNotice(f)).rejects.toThrow("host_changed"); expect(f.notices.current([f.resource])).toEqual([]);
});
it("does not start an offline member; manual restart clears the generation notice", async () => {
  const f = setup(true); await recordOperatorRuntimeNotice(f);
  expect(f.notices.current([session(false, 9)])).toEqual([]);
  f.notices.require(f.resource); f.resource.runtime.status = "offline";
  expect(await recordOperatorRuntimeNotice(f)).toEqual({ state: "offline" }); expect(f.notices.current([f.resource])).toEqual([]);
});
it("does not keep notices for retired or removed members", async () => {
  const f = setup(); await recordOperatorRuntimeNotice(f);
  f.resource.lifecycle = "retired"; expect(f.notices.current([f.resource])).toEqual([]);
  f.notices.require(session()); expect(f.notices.current([])).toEqual([]);
});

// Main-process handler body (DaemonManager.operatorRuntimeNotice) through the real client and a daemon-shaped
// workspace: right after a grant the daemon lists the agent only under agent_operators.
import { CutexClient } from "@cutex-desktop/cutex-client";
import { projectOperatorRuntimeNotice } from "../src/main/operatorRestart";
const agent = (id: string, retired = false) => ({ agent: { cutex_session_id: id, spec: { name: id }, ...(retired ? { retired_at: "2026-11-12T00:00:00Z" } : {}) } });
const grantRow = (id: string, project = "p", grantee = id, retired = false) => ({ grant: { project_id: project, operator_cutex_session_id: grantee, grant_revision: 2, granted_at: "now", granted_by_primary_director_session: "director" }, member: agent(id, retired) });
const daemonWorkspace = (agent_operators: unknown[], extra: Record<string, unknown> = {}) => ({ project_id: "p", authority_epoch: 3, project_revision: 9, lifecycle: "active",
  access_role: "human_management", director: { cutex_session_id: "director", member: agent("director") }, active_agents: [agent("plain")], retired_agents: [],
  operator_grant_revision: 2, agent_operators, ...extra });
function mainPath(workspace: unknown, sessionId: string) {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/projects/p")) return Response.json(workspace);
    if (path.endsWith(`/sessions/${sessionId}`)) return Response.json(session(false, 8));
    throw Error(`unexpected ${path}`);
  });
  const client = new CutexClient({ baseUrl: "http://fixture.invalid", token: "synthetic" }, { fetch, sleep: async () => {} });
  const notices = new OperatorRestartNotices();
  const current = vi.fn(() => true);
  const run = () => projectOperatorRuntimeNotice({ projectId: "p", sessionId, project: () => client.project("p"), read: () => client.session(sessionId), notices, current });
  const sessionReads = () => fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.includes("/sessions/")).length;
  return { run, notices, current, sessionReads };
}
it("records the restart notice for an Operator listed only under agent_operators", async () => {
  const f = mainPath(daemonWorkspace([grantRow("member")]), "member");
  expect(await f.run()).toEqual({ state: "required" });
  expect(f.notices.current([session()])).toEqual(["member"]);
});
it("still records for an active member (revoke path)", async () => {
  const f = mainPath(daemonWorkspace([], { active_agents: [agent("member")] }), "member");
  expect(await f.run()).toEqual({ state: "required" });
});
it.each([
  ["not in any list", daemonWorkspace([])],
  ["grant names another agent", daemonWorkspace([grantRow("member", "p", "someone-else")])],
  ["grant for another project", daemonWorkspace([grantRow("member", "other")])],
  ["retired operator", daemonWorkspace([grantRow("member", "p", "member", true)])],
  ["agent operator view, not human management", daemonWorkspace([grantRow("member")], { access_role: "agent_operator" })],
  ["the Director", daemonWorkspace([grantRow("member")], { director: { cutex_session_id: "member" } })],
])("refuses (%s) before reading the session or recording", async (_, workspace) => {
  const f = mainPath(workspace, "member");
  await expect(f.run()).rejects.toThrow("operator_unavailable");
  expect(f.sessionReads()).toBe(0); expect(f.notices.current([session()])).toEqual([]);
});
it("refuses after a host change during the project read", async () => {
  const f = mainPath(daemonWorkspace([grantRow("member")]), "member"); f.current.mockReturnValue(false);
  await expect(f.run()).rejects.toThrow("operator_unavailable"); expect(f.sessionReads()).toBe(0);
});
