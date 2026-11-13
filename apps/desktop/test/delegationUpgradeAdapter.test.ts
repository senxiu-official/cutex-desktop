import { isUpgradeSnapshotComplete } from "../src/renderer/src/modules/delegations/upgradeContract";
import { delegationUpgradeCapabilities } from "../src/renderer/src/modules/delegations/upgradeCapabilities";
import { expect,it,vi } from "vitest";
import { CutexClient } from "@cutex-desktop/cutex-client";
import {readDelegationUpgrade,executeDelegationUpgrade,projectDelegationTree,delegationEffect,legacyLifecycleEffect} from "../src/shared/delegationUpgradeAdapter";
const policy={projectId:"project",revision:7,memberMode:"approvalRequired",updatedBy:null,updatedAt:null,allowedActions:{update:true}};
const actor={kind:"owner",hostId:null,sessionId:null,name:null,redacted:false};
const approval={id:"approval",projectId:"project",delegationRef:{hostId:"server-canonical",id:"off-page"},requestDigest:`sha256:${"a".repeat(64)}`,policyRevision:7,authorityEpoch:2,revision:9,state:"pending",requestedBy:actor,decidedBy:null,decisionAuthority:null,decisionNote:null,createdAt:"2026-10-27T00:00:00Z",decidedAt:null,allowedActions:{approve:true,deny:true}};
const page={nodes:[],revision:"opaque-tree",nextCursor:"page-two",coverage:"partial",unresolvedEdges:[]};
const receipt={schema:"cutex.delegation-operation.v1",actionId:"stable",operationId:"operation",operation:"policy.update",requestDigest:"b".repeat(64),status:"completed",effectState:"committed",outcomeUnknown:false,revision:1,updatedAt:"2026-10-27T00:00:00Z"};
function fixture(featureList:string[],route:(p:string,i?:RequestInit)=>unknown){const fetch=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const path=new URL(String(input)).pathname;if(path==="/v2/capabilities")return Response.json({hostId:"server-canonical",featureList});const r=route(path,init);return r instanceof Response?r:Response.json(r)});return {fetch,client:new CutexClient({baseUrl:"http://fixture.invalid",token:"synthetic"},{fetch,sleep:async()=>{}})}}
it("old daemon: absent sections, no fake revision and no new calls",async()=>{const {client,fetch}=fixture([],()=>{throw Error("unexpected")});expect(await readDelegationUpgrade(client,"project")).toEqual({projectId:"project",caller:{isOwner:true,canManageMembers:true,canOfflineMembers:true}});expect(fetch).toHaveBeenCalledTimes(1)});
it.each([false,true])("approvals independent of tree capability/page %s",async tree=>{const {client}=fixture(["delegation-routing-v1",...(tree?["delegation-tree-stop-v1"]:[])],p=>p.endsWith("/projects/project")?{active_agents:[{agent:{cutex_session_id:"member",spec:{name:"Member"}}}],retired_agents:[]}:p.endsWith("/delegations")?page:p.endsWith("delegation-policy")?policy:p.endsWith("delegation-grants")?{grants:[],allowedActions:{create:true}}:{routingApprovals:[approval]});const result=await readDelegationUpgrade(client,"project");expect(result).toHaveProperty("approvals",[approval]);if(tree){expect(result.nodes).toEqual([]);expect(result.nextCursor).toBe("page-two")}else{expect(result).not.toHaveProperty("nodes");expect(result).not.toHaveProperty("revision")}});
it("missing allowedActions never inferred from owner",async()=>{const {client}=fixture(["delegation-routing-v1"],p=>p.endsWith("/projects/project")?{active_agents:[],retired_agents:[]}:p.endsWith("delegation-policy")?{...policy,allowedActions:undefined}:p.endsWith("delegation-grants")?{grants:[],allowedActions:{create:true}}:{routingApprovals:[]});await expect(readDelegationUpgrade(client,"project")).rejects.toThrow("allowed_actions_missing")});
it("committed write preserved if refresh fails; one mutation only",async()=>{let reads=0;const {client,fetch}=fixture(["delegation-routing-v1"],(p,i)=>{if(i?.method==="PUT")return{policy,receipt};if(p.endsWith("delegation-policy")&&++reads===1)return policy;throw Error("refresh unavailable")});expect(await executeDelegationUpgrade(client,"project",{kind:"policy",actionId:"stable",memberMode:"open",expectedRevision:7})).toMatchObject({effectState:"committed",receipt,readError:"snapshot_refresh_failed"});expect(fetch.mock.calls.filter(([,i])=>i?.method==="PUT")).toHaveLength(1)});
it("stale approval refuses, never repairs CAS",async()=>{const {client,fetch}=fixture(["delegation-routing-v1"],()=>({...approval,revision:10}));await expect(executeDelegationUpgrade(client,"project",{kind:"decision",actionId:"stable",approvalId:"approval",decision:"approve",expectedDigest:approval.requestDigest,expectedRevision:9})).rejects.toThrow("approval_revision_conflict");expect(fetch.mock.calls.every(([,i])=>i?.method==="GET")).toBe(true)});
it("UI local alias never substituted for canonical host",async()=>{const {client,fetch}=fixture(["delegation-tree-stop-v1"],()=>{throw Error("unexpected")});await expect(executeDelegationUpgrade(client,"project",{kind:"stop",actionId:"stable",nodeId:"ask",nodeHostId:"local",cascade:"descendants",stopJobs:false,expectedRevision:1})).rejects.toThrow("cross_host_scope_unverified");expect(fetch).toHaveBeenCalledTimes(1)});
it("placeholder stays opaque without fabricated identity",()=>{const node={kind:"redactedAncestor",placeholderId:"opaque",labelKey:"delegation.ancestorRestricted",reason:"notVisible",expandable:false,allowedActions:{}} as const;expect(projectDelegationTree({...page,coverage:"partial",nodes:[node]}).nodes).toEqual([node])});

it.each(["committed","permanent_retirement_committed","uncertain"])("retirement exact envelope %s never goes through delegation lookup",async stage=>{
 const archive={request:{reason:"owner-confirmation:hash",action_id:"stable",review:{cutex_session_id:"member",formal_name:"Exact name",operation:"permanent_retire",current_project_id:null,revision:7,runtime_generation:1}},request_sha256:"c".repeat(64),stage,result:null,error:null,committed_at:"2026-10-27T00:00:00Z"};
 const {client,fetch}=fixture(["agent-archive-kind-v1"],(p,i)=>p.endsWith("/projects/project")?{active_agents:[{agent:{cutex_session_id:"member"}}],retired_agents:[],director:null}:p.endsWith("/sessions/member")?{allowedActions:["permanentRetire"]}:archive);
 const result=await executeDelegationUpgrade(client,"project",{kind:"retire",actionId:"stable",payload:{cutex_session_id:"member",confirmed_name:"Exact name",confirmation_token:"synthetic-sensitive-token",expected_revision:7}});
 expect(result.retirementReceipt).toEqual(archive);expect(result.receipt).toBeUndefined();expect(result.effectState).toBe(stage==="committed"?"committed":stage==="uncertain"?"unknown":"partial");
 expect(fetch.mock.calls.some(([url])=>String(url).includes("delegation-operations"))).toBe(false);
});

it("only exact completed committed known control receipt reports committed",()=>{
 expect(delegationEffect({receipt} as any,"stable","policy.update")).toMatchObject({effectState:"committed",receipt});
 expect(delegationEffect({receipt:{...receipt,status:"pending",effectState:"partial"}} as any,"stable","policy.update")).toMatchObject({effectState:"partial"});
});
it.each([{outcomeUnknown:true},{effectState:"unknown"},{status:"pending"},{status:"completed",effectState:"partial"},{requestDigest:"bad"},{revision:0},{revision:1.5},{actionId:"wrong"},{operation:"grant.create"},{status:"transportCompleted"},{outcomeUnknown:undefined},{updatedAt:"not a date"}])("control malformed/uncertain %j never committed",patch=>{
 expect(delegationEffect({receipt:{...receipt,...patch}} as any,"stable","policy.update").effectState).toBe("unknown");
});
const expected={id:"member",actionId:"stable",method:"cutex/session/retire",revision:7,generation:3};
const legacy={contractVersion:2,requestId:"stable",cutexSessionId:"member",cutex:{method:"cutex/session/retire",result:{cutexSessionId:"member",revision:8,lifecycle:"retired",runtimeGeneration:3,status:"offline",retiredAt:"2026-10-27T00:00:00Z",archiveKind:"soft",restorable:true}}};
it("archive/restore positive business results validate independently from HTTP",()=>{
 expect(legacyLifecycleEffect(legacy,expected)).toBe("committed");
 expect(legacyLifecycleEffect({...legacy,cutex:{method:"cutex/session/restore",result:{...legacy.cutex.result,lifecycle:"active",retiredAt:null,archiveKind:"active",restorable:false}}},{...expected,method:"cutex/session/restore"})).toBe("committed");
 const {archiveKind,restorable,...old}=legacy.cutex.result;expect(legacyLifecycleEffect({...legacy,cutex:{...legacy.cutex,result:old}},expected)).toBe("committed");
});
it.each([{cutexSessionId:"wrong"},{revision:0},{revision:6},{runtimeGeneration:2},{status:"closing"},{lifecycle:"active"},{retiredAt:null},{archiveKind:"permanent",restorable:true},{archiveKind:undefined},{extra:"unexpected"}])("archive wrong shape/stale %j stays unknown",patch=>{
 expect(legacyLifecycleEffect({...legacy,cutex:{...legacy.cutex,result:{...legacy.cutex.result,...patch}}},expected)).toBe("unknown");
});
it.each([{outcomeUnknown:true},{requestId:"other"},{cutexSessionId:"wrong"},{contractVersion:3},{cutex:{method:"cutex/session/restore",result:legacy.cutex.result}}])("outer legacy identity %j stays unknown",patch=>expect(legacyLifecycleEffect({...legacy,...patch},expected)).toBe("unknown"));
it("offline uses actual generation/status response, not nonexistent nested session identity",()=>{
 const offline={...legacy,cutex:{method:"cutex/runtime/offline",result:{runtimeGeneration:3,status:"offline",runtimeAgentId:null}}};
 expect(legacyLifecycleEffect(offline,{...expected,method:"cutex/runtime/offline"})).toBe("committed");
 for(const patch of [{status:"closing"},{runtimeGeneration:4},{runtimeGeneration:-1},{runtimeAgentId:5},{outcomeUnknown:true}])expect(legacyLifecycleEffect({...offline,cutex:{...offline.cutex,result:{...offline.cutex.result,...patch}}},{...expected,method:"cutex/runtime/offline"})).toBe("unknown");
});

it.each(["archive","restore","offline"] as const)("actual adapter recognizes typed %s result without inventing control receipt",async kind=>{
 const method=kind==="archive"?"cutex/session/retire":kind==="restore"?"cutex/session/restore":"cutex/runtime/offline";
 const payload=kind==="offline"?{runtimeGeneration:3,status:"offline",runtimeAgentId:null}:{cutexSessionId:"member",revision:8,lifecycle:kind==="archive"?"retired":"active",runtimeGeneration:3,status:"offline",retiredAt:kind==="archive"?"2026-10-27T00:00:00Z":null};
 const {client,fetch}=fixture(kind==="offline"?["agent-activity-v1"]:["agent-archive-kind-v1"],(p,i)=>{
  if(p.endsWith("/projects/project"))return{active_agents:[{agent:{cutex_session_id:"member"}}],retired_agents:[],director:null};
  if(p.endsWith("/sessions/member"))return{revision:7,runtime:{runtimeGeneration:3},allowedActions:["archive","restore"]};
  if(i?.method==="POST")return{contractVersion:2,requestId:"stable",cutexSessionId:"member",cutex:{method,result:payload}};
  throw Error("refresh unavailable");
 });
 const result=await executeDelegationUpgrade(client,"project",{kind,actionId:"stable",memberId:"member"});expect(result.effectState).toBe("committed");expect(result.receipt).toBeUndefined();
 const write=fetch.mock.calls.find(([,i])=>i?.method==="POST")![1]!;expect(JSON.parse(write.body as string).requestId).toBe("stable");
});

it.each([[],["agent-activity-v1"],["agent-archive-kind-v1"],["delegation-routing-v1"],["agent-activity-v1","agent-archive-kind-v1"],["delegation-routing-v1","agent-activity-v1"],["delegation-routing-v1","agent-archive-kind-v1"]].map(extras=>({extras})))("independent capability matrix $extras uses only required reads and fields",async ({extras})=>{
 const activity=extras.includes("agent-activity-v1"),life=extras.includes("agent-archive-kind-v1"),routing=extras.includes("delegation-routing-v1");
 const row={cutexSessionId:"member",hostId:"server-canonical",displayName:"Member",...(activity?{lastActivityAt:null,observedAt:"2026-10-27T00:00:00Z",activityStatus:"unknown"}:{}),...(life?{archiveKind:"active",restorable:false,allowedActions:["archive"],restoreBlockers:[]}: {})};
 const {client,fetch}=fixture(["delegation-tree-stop-v1",...extras],p=>{
  if(p.endsWith("/delegations"))return page;
  if(p.endsWith("/projects/project"))return{active_agents:[{agent:{cutex_session_id:"member",spec:{name:"Member"}}}],retired_agents:[]};
  if(p==="/v2/sessions")return{sessions:[row]};
  if(p.endsWith("delegation-policy"))return policy;
  if(p.endsWith("delegation-grants"))return{grants:[],allowedActions:{create:true}};
  if(p.endsWith("delegation-approvals"))return{routingApprovals:[]};
  throw Error(`unexpected ${p}`);
 });
 const result=await readDelegationUpgrade(client,"project");
 expect(isUpgradeSnapshotComplete(result,delegationUpgradeCapabilities(["delegation-tree-stop-v1",...extras]))).toBe(true);
 if(routing){ const {parties,...wrongKey}=result; expect(isUpgradeSnapshotComplete({...wrongKey,grantParties:parties},delegationUpgradeCapabilities(["delegation-tree-stop-v1",...extras]))).toBe(false); }
 expect(fetch.mock.calls.filter(([u])=>new URL(String(u)).pathname==="/v2/sessions")).toHaveLength(activity||life?2:0);
 expect(fetch.mock.calls.filter(([u])=>new URL(String(u)).pathname.endsWith("/projects/project"))).toHaveLength(activity||life||routing?1:0);
 if(activity||life){expect(result.members?.[0]).toHaveProperty("id","member");expect("observedAt" in result.members![0]!).toBe(activity);expect("archiveKind" in result.members![0]!).toBe(life);}else expect(result).not.toHaveProperty("members");
 if(routing)expect(result).toHaveProperty("parties",[{id:"member",hostId:"server-canonical",name:"Member"}]);else expect(result).not.toHaveProperty("parties");
 expect(result.nodes).toEqual([]);
});
it.each(["agent-activity-v1","agent-archive-kind-v1"])("missing advertised %s fields fails instead of filling defaults",async capability=>{
 const {client}=fixture(["delegation-tree-stop-v1",capability],p=>p.endsWith("/delegations")?page:p.endsWith("/projects/project")?{active_agents:[{agent:{cutex_session_id:"member",spec:{name:"Member"}}}],retired_agents:[]}:{sessions:[{cutexSessionId:"member",hostId:"server-canonical",displayName:"Member"}]});
 await expect(readDelegationUpgrade(client,"project")).rejects.toThrow(capability==="agent-activity-v1"?"delegation_member_activity_missing":"delegation_member_lifecycle_missing");
});

// Agent Operators are listed by the daemon under agent_operators, not active_agents; they are still routing parties.
const operatorRow=(id:string,project="project",extra:Record<string,unknown>={},grantee=id)=>({grant:{project_id:project,operator_cutex_session_id:grantee},member:{agent:{cutex_session_id:id,spec:{name:id.toUpperCase()},...extra}}});
const routingRoute=(workspace:unknown,nodes:unknown[]=[])=>(p:string)=>p.endsWith("/projects/project")?workspace:p.endsWith("/delegations")?{...page,nodes,nextCursor:null,coverage:"complete"}:p.endsWith("delegation-policy")?policy:p.endsWith("delegation-grants")?{grants:[],allowedActions:{create:true}}:{routingApprovals:[approved]};
const approved={...approval,delegationRef:{hostId:"server-canonical",id:"ask"},state:"approved",decidedBy:actor,decisionAuthority:"owner",decidedAt:"2026-10-27T00:00:01Z",allowedActions:{approve:false,deny:false}};
it("operator member is a party; retired, other-project, mismatched and missing operators are not; duplicates collapse",async()=>{
 const workspace={active_agents:[{agent:{cutex_session_id:"member",spec:{name:"Member"}}}],retired_agents:[],agent_operators:[operatorRow("op"),operatorRow("gone","project",{retired_at:"2026-10-27T00:00:00Z"}),operatorRow("elsewhere","other-project"),operatorRow("mismatch","project",{},"someone-else"),{...operatorRow("member"),member:{agent:{cutex_session_id:"member",spec:{name:"Member"}}}}]};
 const {client}=fixture(["delegation-routing-v1"],routingRoute(workspace));
 expect((await readDelegationUpgrade(client,"project")).parties).toEqual([{id:"member",hostId:"server-canonical",name:"Member"},{id:"op",hostId:"server-canonical",name:"OP"}]);
 const {client:old}=fixture(["delegation-routing-v1"],routingRoute({active_agents:[{agent:{cutex_session_id:"member",spec:{name:"Member"}}}],retired_agents:[]}));
 expect((await readDelegationUpgrade(old,"project")).parties).toEqual([{id:"member",hostId:"server-canonical",name:"Member"}]);
});
it("operator without a name fails closed like any party",async()=>{
 const {client}=fixture(["delegation-routing-v1"],routingRoute({active_agents:[],retired_agents:[],agent_operators:[{grant:{project_id:"project",operator_cutex_session_id:"op"},member:{agent:{cutex_session_id:"op",spec:{}}}}]}));
 await expect(readDelegationUpgrade(client,"project")).rejects.toThrow("delegation_party_name_missing");
});

// Owner lifecycle on an Operator: the daemon lists it only under agent_operators; its session allowedActions decide.
const opWorkspace=(rows:unknown[])=>({active_agents:[{agent:{cutex_session_id:"member",spec:{name:"Member"}}}],retired_agents:[],director:null,agent_operators:rows});
const opRow=(id:string,project="project",grantee=id,retired=false)=>({grant:{project_id:project,operator_cutex_session_id:grantee},member:{agent:{cutex_session_id:id,spec:{name:id.toUpperCase()},...(retired?{retired_at:"2026-10-27T00:00:00Z"}:{})}}});
it("member roster lists a valid Operator with its own session lifecycle actions; invalid operator rows stay out",async()=>{
 let lists=0;
 const session=(id:string,actions:string[])=>({cutexSessionId:id,hostId:"server-canonical",displayName:id,archiveKind:"active",restorable:false,allowedActions:actions,restoreBlockers:[]});
 const {client}=fixture(["agent-archive-kind-v1"],p=>p.endsWith("/projects/project")?opWorkspace([opRow("op"),opRow("other","other-project"),opRow("mismatch","project","someone-else"),opRow("gone","project","gone",true)]):{sessions:lists++?[]:["member","op","other","mismatch","gone"].map(id=>session(id,["archive","permanentRetire"]))});
 const result=await readDelegationUpgrade(client,"project");
 expect(result.members?.map(m=>m.id).sort()).toEqual(["member","op"]);
 expect(result.members?.find(m=>m.id==="op")).toMatchObject({allowedActions:["archive","permanentRetire"]});
});
it.each(["offline","archive"] as const)("owner %s of an operator-only member reaches the daemon; a mismatched grant is member_scope_changed",async kind=>{
 const method=kind==="offline"?"cutex/runtime/offline":"cutex/session/retire";
 const payload=kind==="offline"?{runtimeGeneration:3,status:"offline",runtimeAgentId:null}:{cutexSessionId:"op",revision:8,lifecycle:"retired",runtimeGeneration:3,status:"offline",retiredAt:"2026-10-27T00:00:00Z"};
 const run=async(rows:unknown[])=>{const {client,fetch}=fixture(kind==="offline"?["agent-activity-v1"]:["agent-archive-kind-v1"],(p,i)=>{
  if(p.endsWith("/projects/project"))return opWorkspace(rows);
  if(p.endsWith("/sessions/op"))return{revision:7,runtime:{runtimeGeneration:3},allowedActions:["archive"]};
  if(i?.method==="POST")return{contractVersion:2,requestId:"stable",cutexSessionId:"op",cutex:{method,result:payload}};
  throw Error("refresh unavailable");});
  return {fetch,result:executeDelegationUpgrade(client,"project",{kind,actionId:"stable",memberId:"op"})}};
 const ok=await run([opRow("op")]);expect((await ok.result).effectState).toBe("committed");
 const bad=await run([opRow("op","project","someone-else")]);await expect(bad.result).rejects.toThrow("member_scope_changed");
 expect(bad.fetch.mock.calls.some(([,i])=>i?.method==="POST")).toBe(false);
});
