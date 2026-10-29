import { DELEGATION_CAPABILITIES, type DelegationControlRequest, type DelegationRef, type DelegationCapability } from "@cutex-desktop/protocol";

export function delegationId(value: unknown): string {
  if (typeof value !== "string" || !/^(?!\.+$)[A-Za-z0-9_.:-]{1,256}$/.test(value)) throw new Error("bad delegation identifier");
  return value;
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("bad delegation revision");
  return value as number;
}
function reference(value: DelegationRef): DelegationRef {
  if (!value || typeof value !== "object" || Object.keys(value).some(k => k !== "hostId" && k !== "id")) throw new Error("bad delegation reference");
  return { hostId: delegationId(value.hostId), id: delegationId(value.id) };
}
/** Rebuild allowlisted body at BOTH renderer/main and HTTP boundaries. Never replace actionId or CAS. */
export function delegationControlRoute(request: DelegationControlRequest): { method: "POST" | "PUT"; path: string; body: Record<string, unknown>; capability: DelegationCapability } {
  if (!request || typeof request !== "object" || !request.body) throw new Error("bad delegation request");
  const b = request.body; const actionId = delegationId(b.actionId);
  const project = () => `/v2/projects/${delegationId("projectId" in request ? request.projectId : undefined)}`;
  const delegation = () => `/v2/delegations/${delegationId("delegationId" in request ? request.delegationId : undefined)}`;
  const route = (path: string, body: Record<string, unknown>, capability: DelegationCapability, method: "POST" | "PUT" = "POST") => ({ path, body: { actionId, ...body }, capability, method });
  switch (request.kind) {
    case "policy": {
      if (!["approvalRequired", "allowlistedOnly", "open"].includes(request.body.memberMode)) throw new Error("bad member mode");
      return route(`${project()}/delegation-policy`, { expectedRevision: revision(request.body.expectedRevision), memberMode: request.body.memberMode }, DELEGATION_CAPABILITIES.routing, "PUT");
    }
    case "grant": {
      const b = request.body;
      if (Object.keys(b).some(k => !["actionId","requesterRef","targetRefs","rootDelegationRef","purpose","maxUses","expiresAt"].includes(k))) throw new Error("mixed or unknown grant fields");
      if (b.purpose !== "review" || b.maxUses !== 1 || !Array.isArray(b.targetRefs) || !b.targetRefs.length || b.targetRefs.length > 1000) throw new Error("bad reviewer grant");
      if (b.expiresAt !== null && (typeof b.expiresAt !== "string" || !Number.isFinite(Date.parse(b.expiresAt)))) throw new Error("bad grant expiry");
      return route(`${project()}/delegation-grants`, { requesterRef: reference(b.requesterRef), targetRefs: b.targetRefs.map(reference), rootDelegationRef: reference(b.rootDelegationRef), purpose: b.purpose, maxUses: b.maxUses, expiresAt: b.expiresAt }, DELEGATION_CAPABILITIES.routing);
    }
    case "revoke": return route(`/v2/delegation-grants/${delegationId(request.grantId)}/revoke`, { expectedRevision: revision(request.body.expectedRevision) }, DELEGATION_CAPABILITIES.routing);
    case "decision": {
      const b = request.body;
      if (!["approve", "deny"].includes(b.decision) || !/^sha256:[a-f0-9]{64}$/.test(b.expectedDigest) || (b.decisionNote !== null && typeof b.decisionNote !== "string")) throw new Error("bad routing decision");
      return route(`/v2/delegation-approvals/${delegationId(request.approvalId)}/decision`, { decision: b.decision, expectedDigest: b.expectedDigest, expectedRevision: revision(b.expectedRevision), decisionNote: b.decisionNote }, DELEGATION_CAPABILITIES.routing);
    }
    case "stop": {
      if (!["descendants", "none"].includes(request.body.cascade) || typeof request.body.stopJobs !== "boolean") throw new Error("bad delegation stop");
      return route(`${delegation()}/stop`, { cascade: request.body.cascade, stopJobs: request.body.stopJobs, expectedRevision: revision(request.body.expectedRevision) }, DELEGATION_CAPABILITIES.tree);
    }
    case "pause": {
      const b = request.body;
      if (!["afterTurn", "interrupt"].includes(b.mode) || !["members", "all"].includes(b.scope)) throw new Error("bad project pause");
      return route(`${project()}/pause`, { expectedEpoch: revision(b.expectedEpoch), mode: b.mode, scope: b.scope }, DELEGATION_CAPABILITIES.runControl);
    }
    case "resume": return route(`${project()}/resume`, { pauseId: delegationId(request.body.pauseId), expectedEpoch: revision(request.body.expectedEpoch) }, DELEGATION_CAPABILITIES.runControl);
    case "resumeContinuation": return route(`${delegation()}/resume-continuation`, { expectedRevision: revision(request.body.expectedRevision) }, DELEGATION_CAPABILITIES.continuation);
    default: throw new Error("unsupported delegation operation");
  }
}
export function requireDelegationCapability(capabilities: { featureList?: string[] } | null, capability: DelegationCapability): void {
  if (!capabilities?.featureList?.includes(capability)) throw new Error(`unsupported feature: ${capability}`);
}
