import { DELEGATION_CAPABILITIES, type DelegationControlRequest, type DelegationTreePage, type DelegationTreeNode, type DelegationApproval, type DelegationActorAudit, type DelegationGrant, type DelegationOperationResult, type SessionResource } from "@cutex-desktop/protocol";
import { type CutexClient, CutexApiError, delegationId, userAccessOf } from "@cutex-desktop/cutex-client";
import { CONTINUATION_DECISION_REFUSALS } from "./continuationRefusals";
import { projectOperatorMembers } from "./projectOperatorMembers";
import type { ContinuationApprovalRead, ContinuationApprovalRef, ContinuationDecisionRequest, ContinuationResumeRead, UpgradeAction, UpgradeActor, UpgradeApprovalRead, UpgradeNode, UpgradeSnapshot, UpgradeResult } from "./delegationUpgradePreview";

function need(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function flags(value: unknown, keys: readonly string[]): void {
  need(value && typeof value === "object", "delegation_allowed_actions_missing");
  for (const key of keys) need(typeof (value as Record<string, unknown>)[key] === "boolean", "delegation_allowed_actions_missing");
}
function actor(value: DelegationActorAudit): UpgradeActor {
  need(value && ["owner", "agent"].includes(value.kind) && typeof value.redacted === "boolean", "delegation_actor_invalid");
  if (value.kind === "owner") need(value.redacted === false, "delegation_actor_invalid");
  if (value.kind === "owner" || value.redacted) need(value.hostId === null && value.sessionId === null && value.name === null, "delegation_actor_invalid");
  else { delegationId(value.hostId); delegationId(value.sessionId); }
  if (value.kind === "owner") return {kind:"owner",hostId:null,sessionId:null,name:null,redacted:false};
  if (value.redacted) return {kind:"agent",hostId:null,sessionId:null,name:null,redacted:true};
  need(typeof value.hostId === "string" && typeof value.sessionId === "string", "delegation_actor_invalid");
  return {kind:"agent",hostId:value.hostId,sessionId:value.sessionId,name:value.name,redacted:false};
}
export function projectDelegationApproval(value: DelegationApproval): UpgradeApprovalRead {
  flags(value.allowedActions, ["approve", "deny"]); actor(value.requestedBy); if (value.decidedBy) actor(value.decidedBy);
  return { ...value, requestedBy:actor(value.requestedBy),decidedBy:value.decidedBy && actor(value.decidedBy) };
}
export function projectDelegationNode(node: DelegationTreeNode): UpgradeNode {
  need(typeof node.projectId === "string", "delegation_project_missing");
  flags(node.allowedActions, ["readAttempts", "stop", "stopSelf", "stopJobs", "declareContinuation", "resumeContinuation"]);
  return { ...node, projectId:node.projectId };
}
export function projectDelegationTree(page: DelegationTreePage) {
  need(typeof page.revision === "string" && !!page.revision && Array.isArray(page.nodes), "delegation_tree_invalid");
  return { ...page, nodes: page.nodes.map(node => {
    if (node.kind === "delegation") return projectDelegationNode(node);
    need(node.kind === "redactedAncestor" && node.expandable === false && node.reason === "notVisible" && Object.keys(node.allowedActions).length === 0, "delegation_placeholder_invalid");
    return node;
  }) };
}
function grant(value: DelegationGrant) {
  flags(value.allowedActions,["revoke"]);
  // Canonical refs retained; do not synthesize legacy scalar identities.
  return { ...value };
}
function member(row: SessionResource, directorId: string | null, activity: boolean, lifecycle: boolean) {
  if (lifecycle) need(row.archiveKind && typeof row.restorable === "boolean" && Array.isArray(row.allowedActions) && Array.isArray(row.restoreBlockers), "delegation_member_lifecycle_missing");
  if (activity) need(typeof row.observedAt === "string" && row.activityStatus && "lastActivityAt" in row, "delegation_member_activity_missing");
  return { id: row.cutexSessionId, hostId: row.hostId, name: row.displayName, director: row.cutexSessionId === directorId,
    ...(activity ? {lastActivityAt:row.lastActivityAt,observedAt:row.observedAt,activityStatus:row.activityStatus}:{}),
    ...(lifecycle ? {archiveKind:row.archiveKind,restorable:row.restorable,allowedActions:row.allowedActions,restoreBlockers:row.restoreBlockers}:{}) };
}
/** Compose independent authoritative resources. Missing capability means absent section, never a synthetic revision/permission. */
export async function readDelegationUpgrade(client: CutexClient, projectId: string, cursor?: string): Promise<UpgradeSnapshot> {
  delegationId(projectId);
  const caps = await client.capabilities<{ hostId: string; featureList: string[]; user?: unknown }>();
  const enabled = new Set(caps?.featureList ?? []); const access = userAccessOf(caps);
  need(caps && access.isOwner, "owner_delegation_context_required");
  const activity=enabled.has(DELEGATION_CAPABILITIES.activity), lifecycle=enabled.has("agent-archive-kind-v1"), routing=enabled.has(DELEGATION_CAPABILITIES.routing);
  const [tree, policy, grants, runControl, workspace, sessionLists, approvals] = await Promise.all([
    enabled.has(DELEGATION_CAPABILITIES.tree) ? client.delegationTree(projectId,{cursor}) : undefined,
    enabled.has(DELEGATION_CAPABILITIES.routing) ? client.delegationPolicy(projectId) : undefined,
    enabled.has(DELEGATION_CAPABILITIES.routing) ? client.delegationGrants(projectId) : undefined,
    enabled.has(DELEGATION_CAPABILITIES.runControl) ? client.projectRunControl(projectId) : undefined,
    routing || activity || lifecycle ? client.project(projectId) : undefined,
    activity || lifecycle ? Promise.all([client.sessions(),client.sessions("retired")]) : undefined,
    enabled.has(DELEGATION_CAPABILITIES.routing) ? client.delegationApprovals(projectId) : undefined,
  ]);
  if (policy) flags(policy.allowedActions,["update"]);
  if (grants) flags(grants.allowedActions,["create"]);
  if (runControl) flags(runControl.allowedActions,["pause","pauseAll","resume"]);
  const projected = tree && projectDelegationTree(tree);
  // Operators are listed by the daemon under agent_operators only; owner lifecycle actions still come from each session's allowedActions.
  const roster=workspace && [...workspace.active_agents,...projectOperatorMembers(workspace,projectId),...workspace.retired_agents,...(workspace.archived_agents??[])];
  const directorId=workspace?.director?.cutex_session_id ?? null;
  const members=workspace && sessionLists && (()=>{
    const ids=new Set(roster!.map(row=>row.agent.cutex_session_id)); if(directorId)ids.add(directorId);
    return [...sessionLists[0].sessions,...sessionLists[1].sessions].filter(row=>ids.has(row.cutexSessionId)).map(row=>member(row,directorId,activity,lifecycle));
  })();
  const parties=workspace && routing && (()=>{
    // The daemon lists a member holding this project's Agent Operator grant under
    // agent_operators instead of active_agents; it is still a routing member.
    const operators=projectOperatorMembers(workspace,projectId);
    const active=[...workspace.active_agents,...operators,...(workspace.director?.member?[workspace.director.member]:[])];
    return [...new Map(active.filter(row=>!row.agent.retired_at).map(row=>{
      delegationId(row.agent.cutex_session_id); need(typeof row.agent.spec.name === "string","delegation_party_name_missing");
      return [row.agent.cutex_session_id,{id:row.agent.cutex_session_id,hostId:caps.hostId,name:row.agent.spec.name}] as const;
    })).values()];
  })();
  return { projectId, ...(parties ? {parties}:{}), ...(approvals ? {approvals:approvals.routingApprovals.map(projectDelegationApproval)}:{}), ...(projected ?? {}), ...(policy ? {policy}:{}), ...(runControl ? {runControl}:{}),
    ...(grants ? {grants:{items:grants.grants.map(grant),allowedActions:grants.allowedActions}}:{}), ...(members ? {members}:{}),
    ...(projected ? {interruptedDelegations:projected.nodes.filter((n):n is ReturnType<typeof projectDelegationNode>=>n.kind==="delegation").filter(n=>n.execution==="interrupted").map(n=>n.ref)}:{}),
    caller:{isOwner:access.isOwner,canManageMembers:access.isOwner,canOfflineMembers:access.isOwner} };
}
/** Convert UI intent without synthesizing a CAS value or digest. */
export function delegationUpgradeRequest(projectId: string, action: UpgradeAction): DelegationControlRequest {
  const actionId = delegationId(action.actionId);
  switch(action.kind) {
    case "policy": return {kind:action.kind,projectId,body:{actionId,memberMode:action.memberMode,expectedRevision:action.expectedRevision}};
    case "grant": return {kind:action.kind,projectId,body:{actionId,requesterRef:action.requesterRef,targetRefs:action.targetRefs,rootDelegationRef:action.rootDelegationRef,purpose:"review",maxUses:action.maxUses,expiresAt:null}};
    case "revoke": {
      need("expectedRevision" in action && typeof action.expectedRevision === "number", "grant_revision_required");
      return {kind:action.kind,grantId:action.grantId,body:{actionId,expectedRevision:action.expectedRevision}};
    }
    case "decision": return {kind:action.kind,approvalId:action.approvalId,body:{actionId,decision:action.decision,expectedDigest:action.expectedDigest,expectedRevision:action.expectedRevision,decisionNote:action.decisionNote ?? null}};
    case "stop": return {kind:action.kind,delegationId:action.nodeId,body:{actionId,cascade:action.cascade,stopJobs:action.stopJobs,expectedRevision:action.expectedRevision}};
    case "pause": return {kind:action.kind,projectId,body:{actionId,mode:action.mode,scope:action.scope,expectedEpoch:action.expectedEpoch}};
    case "resume": return {kind:action.kind,projectId,body:{actionId,pauseId:action.pauseId,expectedEpoch:action.expectedEpoch}};
    case "resumeContinuation": return {kind:action.kind,delegationId:action.nodeId,body:{actionId,expectedRevision:action.expectedRevision}};
    default: throw new Error("not_delegation_control");
  }
}
const CONTROL_OPERATIONS = {policy:"policy.update",grant:"grant.create",revoke:"grant.revoke",decision:"approval.decide",stop:"delegation.stop",pause:"project.pause",resume:"project.resume",resumeContinuation:"continuation.resume",continuationDecision:"continuation.resume"} as const;
/** Invalid/contradictory receipts retain uncertainty; HTTP completion is not business success. */
export function delegationEffect(result: DelegationOperationResult, actionId?: string, operation?: string): Pick<UpgradeResult,"effectState"|"receipt"> {
  const r=result?.receipt;
  if (!r || r.schema!=="cutex.delegation-operation.v1" || typeof r.actionId!=="string" || !/^(?!\.+$)[A-Za-z0-9_.:-]{1,256}$/.test(r.actionId)
    || (actionId!==undefined&&r.actionId!==actionId) || typeof r.operationId!=="string" || !r.operationId || typeof r.operation!=="string" || !r.operation
    || (operation!==undefined&&r.operation!==operation) || typeof r.requestDigest!=="string" || !/^[a-f0-9]{64}$/.test(r.requestDigest)
    || !Number.isSafeInteger(r.revision) || r.revision<1 || !["pending","completed"].includes(r.status)
    || !["none","partial","committed","unknown"].includes(r.effectState) || typeof r.outcomeUnknown!=="boolean"
    || typeof r.updatedAt!=="string" || !Number.isFinite(Date.parse(r.updatedAt))) return {effectState:"unknown"};
  if (r.outcomeUnknown || r.effectState==="unknown" || (r.status==="pending"&&["committed","none"].includes(r.effectState))
    || (r.status==="completed"&&r.effectState==="partial")) return {effectState:"unknown",receipt:r};
  return {effectState:r.effectState,receipt:r};
}
function object(value:unknown): value is Record<string,unknown> {return !!value&&typeof value==="object"&&!Array.isArray(value);}
const safe=(value:unknown,minimum=0)=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=minimum;
/** Mirrors archive.rs validate_archive_transition_result and runtime dispatch's actual result envelope. */
export function legacyLifecycleEffect(raw:unknown, expected:{id:string;actionId:string;method:string;revision:number;generation:number}): "committed"|"unknown" {
  if(!object(raw)||raw.contractVersion!==2||raw.requestId!==expected.actionId||raw.cutexSessionId!==expected.id||!object(raw.cutex)||raw.cutex.method!==expected.method||!object(raw.cutex.result))return "unknown";
  const r=raw.cutex.result;
  if(raw.outcomeUnknown===true||raw.cutex.outcomeUnknown===true)return "unknown";
  if(r.status!=="offline"||!safe(r.runtimeGeneration)||r.runtimeGeneration!==expected.generation)return "unknown";
  if(expected.method==="cutex/runtime/offline") {
    if(Object.keys(r).some(k=>!["runtimeGeneration","status","runtimeAgentId","actionId","attachCommand"].includes(k))
      || ("runtimeAgentId" in r && r.runtimeAgentId!==null && typeof r.runtimeAgentId!=="string")
      || ("actionId" in r && typeof r.actionId!=="string") || ("attachCommand" in r && typeof r.attachCommand!=="string")) return "unknown";
    return "committed";
  }
  const required=["cutexSessionId","revision","lifecycle","runtimeGeneration","status","retiredAt"];
  if(Object.keys(r).some(k=>!required.includes(k)&&!["archiveKind","restorable"].includes(k))||required.some(k=>!(k in r))
    ||r.cutexSessionId!==expected.id||!safe(r.revision,1)||(r.revision as number)<expected.revision)return "unknown";
  const lifecycle=expected.method==="cutex/session/retire"?"retired":"active";
  if(r.lifecycle!==lifecycle||(lifecycle==="retired"?typeof r.retiredAt!=="string":r.retiredAt!==null))return "unknown";
  if(("archiveKind" in r)!==("restorable" in r))return "unknown";
  if("archiveKind" in r && !(lifecycle==="active"&&r.archiveKind==="active"&&r.restorable===false
    ||lifecycle==="retired"&&r.archiveKind==="soft"&&r.restorable===true
    ||lifecycle==="retired"&&r.archiveKind==="permanent"&&r.restorable===false))return "unknown";
  return "committed";
}

/** Fetch only authoritative controls needed for this action; stale CAS is refused, never repaired. */
export async function executeDelegationUpgrade(client: CutexClient, projectId: string, original: UpgradeAction): Promise<UpgradeResult> {
  delegationId(projectId);
  // Capture the submitted payload before any await; renderer or UI changes cannot alter an unsettled request.
  const action = structuredClone(original);
  const caps = await client.capabilities<{hostId:string;featureList:string[];user?:unknown}>();
  need(caps && userAccessOf(caps).isOwner,"owner_delegation_context_required");
  const features = new Set(caps.featureList);
  let result: UpgradeResult;
  if (action.kind === "retire" || action.kind === "archive" || action.kind === "restore" || action.kind === "offline") {
    if (action.kind === "offline") need(features.has(DELEGATION_CAPABILITIES.activity),"unsupported agent activity");
    else need(features.has("agent-archive-kind-v1"),"unsupported retirement lifecycle");
    const memberId = action.kind === "retire" ? action.payload.cutex_session_id : action.memberId;
    const workspace = await client.project(projectId);
    const members = [...workspace.active_agents,...projectOperatorMembers(workspace,projectId),...workspace.retired_agents,...(workspace.archived_agents??[])];
    need(members.some(row=>row.agent.cutex_session_id===memberId)||workspace.director?.cutex_session_id===memberId,"member_scope_changed");
    const session = await client.session(memberId, action.kind === "restore" ? "retired" : undefined);
    if (action.kind === "retire") {
      need(session.allowedActions?.includes("permanentRetire"),"retirement_not_allowed");
      const receipt = await client.permanentRetirement({...action.payload,action_id:action.actionId});
      need(receipt.request.action_id===action.actionId && receipt.request.review.cutex_session_id===memberId
        && receipt.request.review.operation==="permanent_retire" && receipt.request.review.formal_name===action.payload.confirmed_name
        && receipt.request.review.revision===action.payload.expected_revision && /^[a-f0-9]{64}$/.test(receipt.request_sha256),"retirement_receipt_identity_mismatch");
      result={effectState:receipt.stage==="committed"&&receipt.error===null?"committed":receipt.stage==="uncertain"?"unknown":"partial",retirementStage:receipt.stage,retirementReceipt:receipt,rawResult:receipt};
    } else {
      if (action.kind !== "offline") need(session.allowedActions?.includes(action.kind),"lifecycle_not_allowed");
      const method=action.kind==="offline"?"cutex/runtime/offline":action.kind==="archive"?"cutex/session/retire":"cutex/session/restore";
      // Same requestId on the original route. Keep the result raw; no new delegation receipt is invented.
      const raw=await client.request<import("@cutex-desktop/protocol").CutexRequestResult>("POST",`/v2/sessions/${delegationId(memberId)}/cutex/requests`,{body:{requestId:action.actionId,method,params:action.kind==="offline"?{expectedRuntimeGeneration:session.runtime.runtimeGeneration}:{expectedRevision:session.revision}},retryable:false});
      result={effectState:legacyLifecycleEffect(raw,{id:memberId,actionId:action.actionId,method,revision:session.revision,generation:session.runtime.runtimeGeneration}),rawResult:raw};
    }
  } else {
    const request=delegationUpgradeRequest(projectId,action);
    if(action.kind==="policy") {
      const value=await client.delegationPolicy(projectId); need(value.allowedActions.update,"routing_not_authorized"); need(value.revision===action.expectedRevision,"policy_revision_conflict");
    } else if(action.kind==="decision") {
      const value=await client.delegationApproval(action.approvalId);
      need(value.projectId===projectId,"routing_scope_mismatch"); need(value.allowedActions[action.decision],"delegation_approval_stale"); need(value.requestDigest===action.expectedDigest,"approval_digest_mismatch"); need(value.revision===action.expectedRevision,"approval_revision_conflict");
    } else if(action.kind==="grant"||action.kind==="revoke") {
      const value=await client.delegationGrants(projectId);
      if(action.kind==="grant") need(value.allowedActions.create,"grant_not_allowed");
      else {const found=value.grants.find(g=>g.id===action.grantId);need(found?.allowedActions.revoke,"routing_not_authorized"); need(found.revision===action.expectedRevision,"grant_revision_conflict");}
    } else if(action.kind==="pause"||action.kind==="resume") {
      const value=await client.projectRunControl(projectId);
      need(value.epoch===action.expectedEpoch,"run_control_changed");
      if(action.kind==="pause") need(action.scope==="all"?value.allowedActions.pauseAll:value.allowedActions.pause,"pause_not_allowed");
      else need(value.pauseId===action.pauseId&&value.allowedActions.resume,"resume_not_allowed");
    } else if (action.kind === "stop" || action.kind === "resumeContinuation") {
      need(action.nodeHostId===caps.hostId,"cross_host_scope_unverified");
      const value=await client.delegationTree(projectId,{rootId:action.nodeId,rootHostId:action.nodeHostId});
      const node=value.nodes.find((n):n is DelegationTreeNode=>n.kind==="delegation"&&n.ref.id===action.nodeId&&n.ref.hostId===action.nodeHostId);
      need(node,"delegation_changed");
      if(action.kind==="stop") need((action.cascade==="none"?node.allowedActions.stopSelf:node.allowedActions.stop)&&node.revision===action.expectedRevision,"delegation_changed");
      else need(node.allowedActions.resumeContinuation&&node.continuation?.revision===action.expectedRevision,"continuation_changed");
    }
    const raw=await client.delegationControl(request);
    result={...delegationEffect(raw,action.actionId,CONTROL_OPERATIONS[request.kind]),rawResult:raw};
  }
  // A read failure after a successful write must not become a mutation refusal or trigger a replay.
  try {return {...result,snapshot:await readDelegationUpgrade(client,projectId)};}
  catch {return {...result,readError:"snapshot_refresh_failed"};}
}

/** One delegation's continuation permission, from the owner tree read rooted at it; null = this host cannot say (older
 *  host, not the owner, the delegation is not in that project's tree). Read only: the action goes through
 *  executeDelegationUpgrade, which checks the same node again. */
export async function readContinuationResume(client: CutexClient, projectId: string | null, askId: string): Promise<ContinuationResumeRead | null> {
  if (projectId !== null) delegationId(projectId);
  delegationId(askId);
  const caps = await client.capabilities<{ hostId: string; featureList: string[]; user?: unknown }>();
  const enabled = new Set(caps?.featureList ?? []);
  // r296 ddd0f067: a project-less delegation has no tree; its owner detail carries the same decision card.
  if (projectId === null) {
    if (!caps || !userAccessOf(caps).isOwner || !enabled.has(DELEGATION_CAPABILITIES.continuationApproval)) return null;
    const ask = await client.ask<Record<string, unknown>>(askId);
    if (!ask || ask.askId !== askId || (ask.projectId !== null && ask.projectId !== undefined)) return null;
    const approval = approvalRef(ask.continuationApproval);
    return { nodeHostId: caps.hostId, allowed: false, expectedRevision: null, projectPaused: false, blockedReason: null, approval, limit: null };
  }
  if (!caps || !userAccessOf(caps).isOwner || !enabled.has(DELEGATION_CAPABILITIES.tree) || !enabled.has(DELEGATION_CAPABILITIES.continuation)) return null;
  const [tree, runControl] = await Promise.all([
    client.delegationTree(projectId, { rootId: askId, rootHostId: caps.hostId }),
    enabled.has(DELEGATION_CAPABILITIES.runControl) ? client.projectRunControl(projectId) : undefined,
  ]);
  const node = tree.nodes.find((n): n is DelegationTreeNode => n.kind === "delegation" && n.ref.id === askId && n.ref.hostId === caps.hostId);
  if (!node) return null;
  const projected = projectDelegationNode(node);
  const allowed = !projected.closed && projected.allowedActions.resumeContinuation;
  const reason = projected.allowedActions.resumeContinuationBlockedReason;
  const c = projected.continuation;
  return { nodeHostId: caps.hostId, allowed, expectedRevision: c?.revision ?? null, projectPaused: !!runControl && runControl.phase !== "running",
    // Tolerant: any short code a newer host sends (the renderer falls back for unknown ones).
    blockedReason: !allowed && typeof reason === "string" && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(reason) ? reason : null,
    // r296 (review v2): present whenever this view may decide, even when resumeContinuation is false (busy / offline /
    // paused): the decision commits and the continuation starts when the handler can run.
    approval: enabled.has(DELEGATION_CAPABILITIES.continuationApproval) && !projected.closed ? approvalRef(c?.approval) : null,
    limit: c && (c.limitReason === "rounds" || c.limitReason === "elapsed") && safe(c.maxRounds, 1) && safe(c.maxElapsedSeconds, 1)
      ? { reason: c.limitReason, maxRounds: c.maxRounds, maxElapsedSeconds: c.maxElapsedSeconds } : null };
}

const DIGEST = /^[0-9a-f]{64}$/;
const idOk = (value: unknown): value is string => { try { delegationId(value); return true; } catch { return false; } };
function approvalRef(value: unknown): ContinuationApprovalRef | null {
  if (!object(value) || !idOk(value.id) || !safe(value.revision, 1) || typeof value.digest !== "string" || !DIGEST.test(value.digest) || !safe(value.authorityEpoch)) return null;
  // ddd0f067 cards carry allowedActions; an earlier card (2add91fd) did not and allowed both. Malformed: not decidable.
  const actions = value.allowedActions;
  if (actions !== undefined && (!object(actions) || typeof actions.approve !== "boolean" || typeof actions.deny !== "boolean")) return null;
  return { id: value.id, revision: value.revision as number, digest: value.digest, authorityEpoch: value.authorityEpoch as number,
    allowedActions: actions ? { approve: actions.approve as boolean, deny: actions.deny as boolean } : { approve: true, deny: true } };
}
/** One validated pending approval; anything malformed is left out (never decided from a partial record). */
function continuationApproval(value: unknown, projectId: string | null): ContinuationApprovalRead | null {
  const ref = approvalRef(value);
  if (!ref || !object(value) || !idOk(value.delegationId) || (value.reason !== "elapsed" && value.reason !== "rounds") || typeof value.requestedAt !== "string"
    || typeof value.briefPreview !== "string" || (value.progressPreview !== null && typeof value.progressPreview !== "string")
    || (value.decision !== null && value.decision !== undefined) || !object(value.allowedActions)
    || typeof value.allowedActions.approve !== "boolean" || typeof value.allowedActions.deny !== "boolean") return null;
  return { ...ref, delegationId: value.delegationId, projectId, reason: value.reason, requestedAt: value.requestedAt,
    briefPreview: value.briefPreview.slice(0, 280), progressPreview: typeof value.progressPreview === "string" ? value.progressPreview.slice(0, 480) : null,
    allowedActions: { approve: value.allowedActions.approve, deny: value.allowedActions.deny } };
}
async function approvalCaps(client: CutexClient): Promise<boolean> {
  const caps = await client.capabilities<{ featureList: string[]; user?: unknown }>();
  return !!caps && userAccessOf(caps).isOwner && (caps.featureList ?? []).includes(DELEGATION_CAPABILITIES.continuationApproval);
}
/** r296 pending continuation approvals of a project (null: the project-less ones); [] on hosts without the feature. */
export async function readContinuationApprovals(client: CutexClient, projectId: string | null): Promise<ContinuationApprovalRead[]> {
  if (projectId !== null) delegationId(projectId);
  if (!(await approvalCaps(client))) return [];
  const list = await client.continuationApprovals(projectId);
  return list.flatMap((value) => continuationApproval(value, projectId) ?? []);
}
/** Backend refusals that precede any write (the renderer lifts its unknown-outcome fence on these). */
const DECISION_PRECONDITIONS = CONTINUATION_DECISION_REFUSALS;
/** r296 owner decision: re-reads the approval (same project scope) and writes only on an exact revision / digest / epoch match. */
export async function decideContinuation(client: CutexClient, projectId: string | null, request: ContinuationDecisionRequest): Promise<Pick<UpgradeResult, "effectState" | "receipt">> {
  if (projectId !== null) delegationId(projectId);
  delegationId(request.delegationId); delegationId(request.approvalId); delegationId(request.actionId);
  need(request.decision === "approve" || request.decision === "deny", "invalid_arguments");
  const note = typeof request.decisionNote === "string" ? request.decisionNote.trim() : null;
  need(!note || note.length <= 200, "invalid_arguments");
  need(request.decision === "approve" || !!note, "invalid_arguments");
  need(await approvalCaps(client), "approval_not_allowed");
  const current = (await client.continuationApprovals(projectId)).flatMap((value) => continuationApproval(value, projectId) ?? [])
    .find((a) => a.id === request.approvalId && a.delegationId === request.delegationId);
  need(current, "approval_changed");
  need(current.revision === request.expectedRevision && current.digest === request.expectedDigest && current.authorityEpoch === request.expectedEpoch, "approval_changed");
  need(current.allowedActions[request.decision], "approval_not_allowed");
  let raw: DelegationOperationResult;
  try {
    raw = await client.delegationControl({ kind: "continuationDecision", delegationId: request.delegationId, body: {
      actionId: request.actionId, expectedRevision: request.expectedRevision, expectedDigest: request.expectedDigest,
      expectedEpoch: request.expectedEpoch, decision: request.decision, decisionNote: note || null } });
  } catch (error) {
    // A bare code for the renderer (HTTP errors arrive as "<code>: <message>"); other failures keep their outcome unknown.
    if (error instanceof CutexApiError && DECISION_PRECONDITIONS.has(error.code)) throw new Error(error.code);
    throw error;
  }
  return delegationEffect(raw, request.actionId, "continuation.resume");
}
