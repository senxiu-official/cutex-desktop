// Service owner candidates come from cutex's eligible-owners endpoint when supported,
// or the service host's sidebar snapshot on older daemons.
// Everything here beyond eligibility is presentation: the project's Director and members first, a
// search box, offline agents folded away, and one-off chats (no agent name, just a thread title as
// displayName) hidden until searched, so a raw first-message line never leads the list.
import type { EligibleServiceOwner } from "../../../shared/serviceOwners";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { ServiceView, SidebarSnapshot } from "../../../shared/ipc";
import { realAgentName } from "./agentAlias";
import { compareNames } from "./rosterOrder";

/** Choice groups in display order: the service's project first, then everyone, offline folded last. */
export type OwnerGroup = "project" | "all" | "offline";

export interface OwnerChoice {
  id: string;
  /** The daemon's display name (cutex resolves alias > formal name > thread title). */
  name: string;
  /** The real name under a display alias (tooltip), when it differs. */
  real: string | null;
  isDirector: boolean;
  isCurrent: boolean;
  /** A one-off chat without an agent name (displayName is just its thread title). */
  unnamed: boolean;
  offline: boolean;
  group: OwnerGroup;
}


/** cutex's activity projection marks offline (additive r266); older cutex falls back to the runtime status. */
const isOffline = (s: SessionResource): boolean => s.activityStatus === "offline" || s.runtime?.status === "offline";

/** The named-ness the picker sorts by: a real agent (formal name, owner alias or non-local registration),
 * not a one-off local chat whose displayName is just its thread title. */
const isNamed = (s: SessionResource): boolean => !!s.formalAgentName || !!s.displayNameOverride?.trim() || s.registrationClass !== "local_only";

/** Legacy sidebar fallback: one host's active sessions (retired rows stay excluded). */
export function ownerChoices(service: Pick<ServiceView, "ownerCutexSessionId" | "projectId">, sidebar: SidebarSnapshot | null | undefined): OwnerChoice[] {
  const project = service.projectId ? (sidebar?.projects?.projects ?? []).find((p) => p.project_id === service.projectId) : undefined;
  const director = project?.director_cutex_session_id ?? null;
  const member = new Set(
    service.projectId
      ? Object.entries(sidebar?.hostRows ?? {}).filter(([, row]) => row?.projectId === service.projectId).map(([id]) => id)
      : [],
  );
  const choices: OwnerChoice[] = [];
  for (const s of sidebar?.active ?? []) {
    const offline = isOffline(s);
    choices.push({
      id: s.cutexSessionId,
      name: s.displayName,
      real: realAgentName(s) !== s.displayName ? realAgentName(s) : null,
      isDirector: !!director && s.cutexSessionId === director,
      isCurrent: s.cutexSessionId === service.ownerCutexSessionId,
      unnamed: !isNamed(s),
      offline,
      group: member.has(s.cutexSessionId) || (!!director && s.cutexSessionId === director) ? "project" : offline ? "offline" : "all",
    });
  }
  return sortOwnerChoices(choices);
}

/** Backend `online` only controls the presentation fold; it never excludes a candidate. */
export function eligibleOwnerChoices(service: Pick<ServiceView, "ownerCutexSessionId" | "projectId">, owners: readonly EligibleServiceOwner[]): OwnerChoice[] {
  return sortOwnerChoices(owners.map((owner) => ({
    id: owner.id,
    name: owner.name,
    real: owner.realName && owner.realName !== owner.name ? owner.realName : null,
    isDirector: owner.isDirector,
    isCurrent: owner.id === service.ownerCutexSessionId,
    unnamed: owner.unnamed,
    offline: !owner.online,
    group: owner.isDirector || (!!service.projectId && owner.projectId === service.projectId) ? "project" : owner.online ? "all" : "offline",
  })));
}

function sortOwnerChoices(choices: OwnerChoice[]): OwnerChoice[] {
  const rank = (c: OwnerChoice) => (c.isDirector ? 0 : c.group === "project" ? 1 : 2);
  return choices.sort((a, b) => rank(a) - rank(b) || compareNames(a.name, b.name) || a.id.localeCompare(b.id));
}

/** `query` filters by the shown name, the real name under an alias or the session id; it also unmasks unnamed one-off chats. */
export function filterOwnerChoices(choices: readonly OwnerChoice[], query: string): OwnerChoice[] {
  const q = query.trim().toLowerCase();
  if (!q) return choices.filter((c) => !c.unnamed || c.isCurrent);
  return choices.filter((c) => c.name.toLowerCase().includes(q) || (c.real?.toLowerCase().includes(q) ?? false) || c.id.toLowerCase().includes(q));
}
