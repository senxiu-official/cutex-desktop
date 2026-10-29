import type { UpgradeApprovalRead } from "../../../shared/delegationUpgradePreview";
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" && value.length > 0;
const nullableText = (value: unknown) => value === null || typeof value === "string";
const ref = (value: unknown): value is { hostId: string; id: string } => object(value) && text(value.hostId) && text(value.id);
const flags = (value: unknown, keys: readonly string[]) => object(value) && keys.every(key => typeof value[key] === "boolean");
function actor(value: unknown): boolean {
  if (!object(value)) return false;
  if (value.kind === "owner") return value.hostId === null && value.sessionId === null && value.name === null && value.redacted === false;
  if (value.kind !== "agent") return false;
  return value.redacted === true ? value.hostId === null && value.sessionId === null && value.name === null
    : value.redacted === false && text(value.hostId) && text(value.sessionId) && nullableText(value.name);
}
export function isUpgradeApprovalRead(value: unknown): value is UpgradeApprovalRead {
  return object(value) && text(value.id) && text(value.projectId) && ref(value.delegationRef)
    && text(value.requestDigest) && Number.isSafeInteger(value.revision) && Number.isSafeInteger(value.policyRevision)
    && Number.isSafeInteger(value.authorityEpoch) && flags(value.allowedActions, ["approve", "deny"])
    && ["pending", "approved", "denied", "stale", "cancelled"].includes(String(value.state))
    && actor(value.requestedBy) && (value.decidedBy === null || actor(value.decidedBy))
    && [null, "owner", "director"].includes(value.decisionAuthority as string | null)
    && nullableText(value.decisionNote) && nullableText(value.decidedAt) && text(value.createdAt);
}
