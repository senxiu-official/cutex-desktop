import { describe, expect, it, vi } from "vitest";
import { CutexClient } from "../src/client";
import { delegationControlRoute } from "../src/delegation";
import { DELEGATION_CAPABILITIES, type DelegationControlRequest } from "@cutex-desktop/protocol";
const features = Object.values(DELEGATION_CAPABILITIES);
const ref = { hostId: "host", id: "agent" };
const requests: DelegationControlRequest[] = [
 { kind: "policy", projectId: "project", body: { actionId: "action", expectedRevision: 7, memberMode: "open" } },
 { kind: "grant", projectId: "project", body: { actionId: "action", requesterRef: ref, targetRefs: [ref], rootDelegationRef: ref, purpose: "review", maxUses: 1, expiresAt: null } },
 { kind: "revoke", grantId: "grant", body: { actionId: "action", expectedRevision: 9 } },
 { kind: "decision", approvalId: "approval", body: { actionId: "action", decision: "approve", expectedDigest: `sha256:${"a".repeat(64)}`, expectedRevision: 11, decisionNote: null } },
 { kind: "stop", delegationId: "ask", body: { actionId: "action", cascade: "descendants", stopJobs: false, expectedRevision: 12 } },
 { kind: "pause", projectId: "project", body: { actionId: "action", expectedEpoch: 8, mode: "afterTurn", scope: "members" } },
 { kind: "resume", projectId: "project", body: { actionId: "action", pauseId: "pause", expectedEpoch: 9 } },
 { kind: "resumeContinuation", delegationId: "ask", body: { actionId: "action", expectedRevision: 13 } },
];
function fixture(featureList: string[] = features, response: unknown = {}, status = 200, user?: unknown) {
 const fetch = vi.fn(async (input: unknown) => String(input).endsWith("/v2/capabilities")
   ? Response.json({ featureList, ...(user === undefined ? {} : { user }) })
   : Response.json(response, { status }));
 const client = new CutexClient({ baseUrl: "http://fixture.invalid", token: "synthetic" }, { fetch: fetch as typeof globalThis.fetch, sleep: async () => {} });
 return { fetch, client };
}
describe("r266 exact owner transport", () => {
 it("concurrent new reads share only in-flight discovery; later read probes again",async()=>{
  const {client,fetch}=fixture();await Promise.all([client.delegationPolicy("project"),client.delegationGrants("project"),client.delegationApprovals("project")]);
  expect(fetch.mock.calls.filter(c=>String(c[0]).endsWith("/v2/capabilities"))).toHaveLength(1);
  await client.delegationPolicy("project");expect(fetch.mock.calls.filter(c=>String(c[0]).endsWith("/v2/capabilities"))).toHaveLength(2);
 });
 it("mixed legacy grant identities refuse before any request",async()=>{
  const {client,fetch}=fixture();const request=structuredClone(requests[1]!) as any;request.body.requesterSessionId="legacy";
  await expect(client.delegationControl(request)).rejects.toThrow("mixed");expect(fetch).not.toHaveBeenCalled();
 });
 it("explicit exact retry preserves action/path/body rather than replacing CAS",async()=>{
  const {client,fetch}=fixture();await client.delegationControl(requests[0]!);await client.delegationControl(requests[0]!);
  expect(fetch.mock.calls[1]).toEqual(fetch.mock.calls[3]);
 });
 it("settlement missing capability issues no close route", async()=>{
  const {client,fetch}=fixture([]); await expect(client.closeBusMessage({messageId:"message",expectedEvidenceToken:"evidence",requestId:"stable",reason:"Synthetic owner review"})).rejects.toThrow("unsupported"); expect(fetch).toHaveBeenCalledTimes(1);
 });
 it.each(requests)("sends stable strict $kind body and exact path", async request => {
  const paths = {policy:["PUT","/v2/projects/project/delegation-policy"],grant:["POST","/v2/projects/project/delegation-grants"],revoke:["POST","/v2/delegation-grants/grant/revoke"],decision:["POST","/v2/delegation-approvals/approval/decision"],stop:["POST","/v2/delegations/ask/stop"],pause:["POST","/v2/projects/project/pause"],resume:["POST","/v2/projects/project/resume"],resumeContinuation:["POST","/v2/delegations/ask/resume-continuation"]};
  const [method,path]=paths[request.kind]; const {client, fetch} = fixture();
  await client.delegationControl(request);
  const [url, init] = fetch.mock.calls[1] as unknown as [string, RequestInit];
  expect(url).toBe(`http://fixture.invalid${path}`); expect(init.method).toBe(method);
  expect(JSON.parse(init.body as string)).toEqual(request.body);
 });
 it.each(requests)("old daemon: $kind issues no new route", async request => {
  const {client, fetch} = fixture([]); await expect(client.delegationControl(request)).rejects.toThrow("unsupported");
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it("no owner routes for a restricted principal even if global capability advertised", async () => {
  const {client, fetch} = fixture(features, {}, 200, {isOwner:false});
  await expect(client.delegationPolicy("project")).rejects.toThrow("owner"); expect(fetch).toHaveBeenCalledTimes(1);
 });
 it.each([409,503])("does not retry %s mutations", async status => {
  const {client, fetch} = fixture(features, {error:{code:"conflict",message:"conflict"}},status);
  await expect(client.delegationControl(requests[0]!)).rejects.toMatchObject({status}); expect(fetch).toHaveBeenCalledTimes(2);
 });
 it("ambiguous disconnect never creates another mutation", async () => {
  const {client, fetch} = fixture(); fetch.mockImplementationOnce(async()=>Response.json({featureList:features}));
  fetch.mockRejectedValueOnce(new TypeError("lost reply")); await expect(client.delegationControl(requests[0]!)).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(2);
 });
 it("receipt miss is returned unchanged and performs no POST", async () => {
  const reply = {schema:"cutex.delegation-operation.v1",actionId:"old-action",status:"notFound",outcomeUnknown:true,result:null};
  const {client,fetch} = fixture(features,reply); expect(await client.delegationOperation("old-action")).toEqual(reply);
  expect(fetch.mock.calls.map(c=>String(c[0]))).toEqual(["http://fixture.invalid/v2/capabilities","http://fixture.invalid/v2/delegation-operations/old-action"]);
 });
 it("read collections/detail/tree retain original wire fields", async () => {
  const {client,fetch} = fixture(features,{routingApprovals:[]}); await client.delegationApprovals("project"); await client.delegationApproval("approval");
  await client.delegationTree("project",{cursor:"opaque",limit:12,rootId:"root",rootHostId:"host"});
  expect(String(fetch.mock.calls[1]![0])).toContain("/projects/project/delegation-approvals");
  expect(String(fetch.mock.calls[3]![0])).toContain("/delegation-approvals/approval");
  expect(String(fetch.mock.calls[5]![0])).toContain("/projects/project/delegations?");
 });
 it.each([".","..","a/b","%2e","x?y", "a".repeat(257)])("rejects unsafe identity %s before network", async id=>{
  const {client,fetch}=fixture(); await expect(client.delegationOperation(id)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
 });
 it("rebuilds body without injected actor/authority fields",()=>{
  const request=structuredClone(requests[0]!) as any; request.body.actor="owner";
  expect(delegationControlRoute(request).body).toEqual(requests[0]!.body);
 });
 it("retirement stays snake_case and does not wrap archive receipt",async()=>{
  const receipt={request_sha256:"hash",stage:"permanent_retirement_committed",committed_at:"time",error:{cleanup:"partial"}};
  const {client,fetch}=fixture(["agent-archive-kind-v1"],receipt);
  expect(await client.permanentRetirement({action_id:"stable",cutex_session_id:"agent",confirmed_name:"Exact pasted name",confirmation_token:"synthetic",expected_revision:7})).toEqual(receipt);
  expect(String(fetch.mock.calls[1]![0])).toContain("/permanent-retirement/execute");
 });
});
