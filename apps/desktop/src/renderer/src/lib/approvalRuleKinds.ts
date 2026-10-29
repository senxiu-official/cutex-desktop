// Which design-047 rule kinds this conversation can actually trigger. Keep this
// pure: the composer already owns the session, role and host-capability facts.
import type { ApprovalKind, ApprovalRule, ApprovalRuleDraft } from "../../../shared/ipc";

export const APPROVAL_RULE_KINDS: readonly ApprovalKind[] = [
  "managed_service",
  "service_lifetime",
  "static_root",
  "agent_profile",
  "ask_delivery",
  "browser_claim",
  "browser_open",
  "workflow_run",
];

const TOOLS_BY_KIND: Readonly<Record<ApprovalKind, readonly string[]>> = {
  managed_service: ["service_register", "service_update"],
  service_lifetime: ["service_register", "service_update"],
  static_root: ["service_register", "service_update"],
  agent_profile: ["agent_create", "member_replace"],
  ask_delivery: ["agent_delegate"],
  browser_claim: ["browser_claim"],
  browser_open: ["browser_open"],
  workflow_run: ["workflow_start"],
};

type SchemaCapabilities = { cutexTools?: unknown; features?: unknown };

/** An explicit per-session cutex tool list, when a runtime reports one. Null means unknown. */
export function declaredCutexTools(schema: unknown): readonly string[] | null {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return null;
  const capabilities = (schema as { capabilities?: unknown }).capabilities;
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) return null;
  const value = (capabilities as SchemaCapabilities).cutexTools;
  if (!Array.isArray(value) || !value.every((tool) => typeof tool === "string")) return null;
  return value;
}

/** Explicit create/replace capability, including the role-filtered tool list when present. */
export function declaredAgentCreate(schema: unknown): boolean | null {
  const tools = declaredCutexTools(schema);
  if (tools) return TOOLS_BY_KIND.agent_profile.some((tool) => tools.includes(tool));
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return null;
  const capabilities = (schema as { capabilities?: unknown }).capabilities;
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) return null;
  const features = (capabilities as SchemaCapabilities).features;
  if (!features || typeof features !== "object" || Array.isArray(features)) return null;
  const value = (features as Record<string, unknown>).agentCreate;
  return typeof value === "boolean" ? value : null;
}

export interface ApprovalKindFacts {
  /** null while the session identity is not known; then visibility fails open. */
  formalAgent: boolean | null;
  /** Host feature list; null while it has not loaded. */
  hostFeatures: ReadonlySet<string> | null;
  /** Current Director role. Operators are covered by explicit `agentCreate`. */
  isDirector: boolean | null;
  /** Profile browser-tools switch; null while the Profile list has not loaded. */
  browserTools: boolean | null;
  /** Runtime-declared role-filtered cutex tools, when available. */
  declaredTools: readonly string[] | null;
  /** Runtime-declared create/replace capability, when available. */
  agentCreate: boolean | null;
}

export type ApprovalIdentityRole = "director" | "operator" | null;

/**
 * The project sidebar owns the role projection. Missing Operator data is unknown,
 * so an older desktop/daemon shows no Operator claim instead of guessing one.
 */
export function approvalIdentityRole(isDirector: boolean | null, operatorSessionIds: readonly string[] | undefined, sessionId: string): ApprovalIdentityRole {
  if (isDirector) return "director";
  return operatorSessionIds?.includes(sessionId) ? "operator" : null;
}

/** Rule kinds shown in the per-agent popover. Unknown facts show all kinds. */
export function availableApprovalKinds(facts: ApprovalKindFacts): ApprovalKind[] {
  if (facts.formalAgent === null || facts.hostFeatures === null) return [...APPROVAL_RULE_KINDS];
  if (facts.declaredTools) {
    return APPROVAL_RULE_KINDS.filter((kind) => TOOLS_BY_KIND[kind].some((tool) => facts.declaredTools!.includes(tool)));
  }
  if (!facts.formalAgent) {
    if (facts.browserTools === null) return [...APPROVAL_RULE_KINDS];
    return facts.browserTools ? ["browser_claim", "browser_open"] : [];
  }
  return APPROVAL_RULE_KINDS.filter((kind) => {
    if (kind === "agent_profile") return facts.isDirector === true || facts.agentCreate === true;
    if (kind === "ask_delivery") return facts.hostFeatures!.has("agent-asks");
    if (kind === "workflow_run") return facts.hostFeatures!.has("workflows");
    if (kind === "browser_claim" || kind === "browser_open") return facts.browserTools !== false;
    return facts.hostFeatures!.has("services");
  });
}

/** Only an explicitly high-risk rule opens the typed confirmation dialog. */
export function ruleSaveAction(draft: Pick<ApprovalRuleDraft, "highRiskKindsExplicit">): "save" | "confirm" {
  return draft.highRiskKindsExplicit.length ? "confirm" : "save";
}

export function isDirectorRoleRule(rule: Pick<ApprovalRule, "grantedBy">): boolean {
  return rule.grantedBy === "role:director";
}

/** Strip server-only fields before a PATCH (the Rust draft denies unknown fields). */
export function approvalRuleDraft(rule: ApprovalRule, enabled = rule.enabled): ApprovalRuleDraft {
  return {
    enabled,
    subject: rule.subject,
    projectId: rule.projectId,
    kinds: rule.kinds,
    constraints: rule.constraints,
    expiry: rule.expiry,
    highRiskKindsExplicit: rule.highRiskKindsExplicit,
  };
}
