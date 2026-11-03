// An agent the sidebar snapshots do not hold (owner 2026-11-01: the agent an agent_create row is creating, another host's,
// a deleted one, a bus message's addressee): the initials and frame colour components/Avatar draws its letter tile with
// (`agent` prop), computed the way lib/agentLook does for agents it holds — so the chip already shows what the sidebar
// will show once the agent arrives.
import type { SidebarSnapshot } from "../../../shared/ipc";
import { sidebarOf, useApp } from "../store";
import { initialStem, listInitials, twoLetterInitials } from "./agentInitials";
import { providerTint, type ProviderTint } from "./avatarThemes";
import { profileLookOf, useProfileLooksVersion } from "./profileLooks";

/**
 * What a caller knows of an agent the snapshots do not hold (owner 2026-11-01: an agent_create row for an agent still
 * being created, another host's agent, a deleted one): its host, project and Profile / model, as far as known. Avatar
 * then draws its letter tile — never a person's round letter on a fill — with the initials the sidebar will give it
 * (hintInitials) and the provider colour of the model if known (hintTint), else a neutral frame.
 */
export interface AgentHint {
  hostId?: string | null;
  /** Its project (agent_create `project_id`, else the creating Director's). */
  projectId?: string | null;
  /** Its Profile (name or id): the model's colour when `model` / `cliKind` are not given. */
  profile?: string | null;
  model?: string | null;
  cliKind?: string | null;
}

const PENDING = "\u0000pending";

/**
 * Pure: the initials of agent `name` as the sidebar would give it in `projectId`'s list on the host of `snapshot`
 * (initialsOf: that project's live agents, its slug / display name / shared prefix skipped, a clash goes to the newer —
 * this one, the newest). A live agent of that name keeps its own letters. No project / snapshot: the name's plain two
 * letters (initialStem without a prefix), like an independent agent.
 */
export function hintInitials(snapshot: SidebarSnapshot | null, name: string, projectId: string | null | undefined): string {
  const plain = twoLetterInitials(initialStem(name));
  if (!snapshot || !projectId) return plain;
  const project = (snapshot.projects?.projects ?? []).find((p) => p.project_id === projectId);
  const members = snapshot.active.filter((s) => snapshot.hostRows[s.cutexSessionId]?.projectId === projectId);
  const same = members.find((s) => s.displayName.trim().toLowerCase() === name.trim().toLowerCase());
  const items = members.map((s) => ({ key: s.cutexSessionId, name: s.displayName, order: s.createdAt }));
  if (!same) items.push({ key: PENDING, name, order: "￿" });
  return listInitials(items, [projectId, project?.presentation?.display_name || projectId]).get(same?.cutexSessionId ?? PENDING) ?? plain;
}

/** The provider colour a hint names (its model / CLI, else its Profile's); null = unknown (a neutral frame). */
export function hintTint(hint: AgentHint | null | undefined, focusHost = "local"): ProviderTint | null {
  if (!hint) return null;
  const profile = hint.profile ? profileLookOf(hint.hostId ?? focusHost, hint.profile) : null;
  const model = hint.model ?? profile?.model ?? null;
  const cliKind = hint.cliKind ?? profile?.cliKind ?? null;
  return model || cliKind ? providerTint({ model, cliKind }) : null;
}

/** Avatar: the initials and frame colour of an agent the app does not hold (`enabled` false: nothing is read). */
export function useHintLook(name: string, hint: AgentHint | null | undefined, enabled: boolean): { initial: string; tint: ProviderTint | null } | null {
  const hostId = hint?.hostId ?? null, projectId = hint?.projectId ?? null;
  const initial = useApp((s) => (enabled ? hintInitials(sidebarOf(s, hostId), name, projectId) : null));
  const focus = useApp((s) => s.hosts?.active ?? "local");
  useProfileLooksVersion();
  return enabled && initial ? { initial, tint: hintTint(hint, focus) } : null;
}
