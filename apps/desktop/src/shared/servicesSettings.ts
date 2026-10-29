// cutex services registry settings the desktop edits (`PATCH /v2/services`, root). Today only
// `agentPersistentApproval` (cutex `services-persistent-approval`, docs/SERVICES.md in cutex):
// `ask` (default) = an agent's request for a persistent service lifetime raises a service_lifetime
// approval; `off` = it is granted without one. The managed-execution approval (managed_service) is a
// separate gate and stays on either way. cutex validates again; this keeps the renderer's patch to
// the known keys and values.
import type { AgentPersistentApproval, ServicesSettings, ServicesSettingsPatch } from "./ipc";

export const SERVICES_PERSIST_APPROVAL_FEATURE = "services-persistent-approval";
export const SERVICES_EPHEMERAL_TTL_FEATURE = "services-ephemeral-ttl";
export const SERVICES_ORGANIZE_FEATURE = "services-organize";
/** cutex: owner `loginLinkCommand` on managed services + own-Origin rewrite for `proxyHostHeader: upstream`. */
export const SERVICES_LOGIN_LINK_FEATURE = "services-login-link";
/** cutex r267: `ownerScope` session | project on services; the owner switches it with PATCH {ownerScope, projectId?}. */
export const SERVICES_PROJECT_SCOPE_FEATURE = "services-project-scope";
export const DEFAULT_AGENT_PERSISTENT_APPROVAL: AgentPersistentApproval = "ask";

export function isAgentPersistentApproval(v: unknown): v is AgentPersistentApproval {
  return v === "ask" || v === "off";
}

/** The setting as the daemon reports it; null when this cutex does not report it (older daemon). */
export function agentPersistentApprovalOf(settings: Partial<ServicesSettings> | null | undefined): AgentPersistentApproval | null {
  const v = settings?.agentPersistentApproval;
  return isAgentPersistentApproval(v) ? v : null;
}

/** The body main sends: known keys with valid values only; throws on anything else. */
export function servicesSettingsPatch(patch: unknown): ServicesSettingsPatch {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) throw new Error("bad services settings patch");
  const out: ServicesSettingsPatch = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === "agentPersistentApproval" && isAgentPersistentApproval(value)) out.agentPersistentApproval = value;
    else if (
      key === "ephemeralIdleMinutes" &&
      typeof value === "number" &&
      Number.isInteger(value) &&
      (value === 0 || (value >= 5 && value <= 1440))
    )
      out.ephemeralIdleMinutes = value;
    else throw new Error(`bad services setting ${key}`);
  }
  if (Object.keys(out).length === 0) throw new Error("empty services settings patch");
  return out;
}
