import { describe, expect, it } from "vitest";
import {
  CutexClient, hasOperatorActionsProjection, OPERATOR_ACTION_SCHEMA,
  type OperatorActionRequest, type OperatorProjectWorkspace,
} from "../src/index";

function clientWith(status: number, response: unknown) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(response), { status });
  }) as typeof globalThis.fetch;
  return { client: new CutexClient({ baseUrl: "http://fixture.invalid", token: "synthetic-owner" }, { fetch }), calls };
}

const request: OperatorActionRequest = {
  schema: OPERATOR_ACTION_SCHEMA, action_id: "stable-action", project_id: "project-one",
  expected_authority_epoch: 8, expected_grant_revision: 0,
  operation: "grant", operator_cutex_session_id: "cutex.operator",
};
const olderProject: OperatorProjectWorkspace = {
  project_id: "project-one", authority_epoch: 8,
  presentation: { display_name: "Project", badge_label: "P", color: "cyan" },
  active_agents: [], retired_agents: [],
};

describe("owner Operator client", () => {
  it("forwards the exact snake_case grant, both CAS values and stable action ID", async () => {
    const receipt = { schema: OPERATOR_ACTION_SCHEMA, action_id: "stable-action", grant_revision: 1, roster: { grant_revision: 1, operators: [] } };
    const { client, calls } = clientWith(200, receipt);
    expect(await client.operatorAction(request)).toEqual(receipt);
    expect(calls).toEqual([{ url: "http://fixture.invalid/v2/agent-management/operator-actions", method: "POST", body: request }]);
  });

  it("supports revoke and preserves absent optional fields without manufacturing fences", async () => {
    const { client, calls } = clientWith(200, {});
    const revoke: OperatorActionRequest = {
      schema: OPERATOR_ACTION_SCHEMA, project_id: "project-one", operation: "revoke", operator_cutex_session_id: "cutex.operator",
    };
    await client.operatorAction(revoke);
    expect(calls[0]?.body).toEqual(revoke);
    expect(calls[0]?.body).not.toHaveProperty("expected_grant_revision");
    expect(calls[0]?.body).not.toHaveProperty("expected_authority_epoch");
  });

  it.each([403, 404, 405, 409])("retains HTTP %s refusal without a fallback or retry", async (status) => {
    const { client, calls } = clientWith(status, {
      contractVersion: 2, error: { code: "daemon_refusal", message: "refused", retryable: false, details: { fence: "canonical" } },
    });
    await expect(client.operatorAction(request)).rejects.toMatchObject({ status, code: "daemon_refusal", details: { fence: "canonical" } });
    expect(calls).toHaveLength(1);
  });

  it("reads the typed project with encoded ID and accepts missing old-daemon projections", async () => {
    const { client, calls } = clientWith(200, olderProject);
    const project = await client.project("project/one ?");
    expect(project).toEqual(olderProject);
    expect(calls[0]?.url).toBe("http://fixture.invalid/v2/agent-management/projects/project%2Fone%20%3F");
    expect(hasOperatorActionsProjection(project)).toBe(false);
  });

  it("preserves the daemon's generic CAS conflict code and reason-bearing message", async () => {
    const { client, calls } = clientWith(409, {
      contractVersion: 2,
      error: { code: "conflict", message: "conflict: operator_grant_revision_conflict", retryable: false, details: {} },
    });
    await expect(client.operatorAction(request)).rejects.toMatchObject({
      status: 409, code: "conflict", message: expect.stringContaining("operator_grant_revision_conflict"),
    });
    expect(calls).toHaveLength(1);
  });

  it("requires the real roster projection and a safe nonnegative CAS revision", () => {
    expect(hasOperatorActionsProjection({ ...olderProject, agent_operators: [], operator_grant_revision: 0 })).toBe(true);
    expect(hasOperatorActionsProjection({ ...olderProject, agent_operators: [] })).toBe(false);
    expect(hasOperatorActionsProjection({ ...olderProject, operator_grant_revision: 4 })).toBe(false);
    for (const revision of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(hasOperatorActionsProjection({ ...olderProject, agent_operators: [], operator_grant_revision: revision })).toBe(false);
    }
  });
});
