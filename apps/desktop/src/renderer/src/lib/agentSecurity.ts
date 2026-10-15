// Agent security settings (cutex `/v2/settings` → `agentSecurity`, docs/agent-tool-security.md §4):
// how far agents reach beyond their own project. Domains are `project:<id>` or `agent:<root
// cutexSessionId>` (an agent outside every project: its creator tree). The owner can link two
// domains, grant a project one external agent (`agent-external-grants`), or switch the host back to
// host-wide visibility. Pure helpers (the settings hook is in agentSecurityView.ts).
import type { DomainKey, ExternalAgentGrant, SidebarSnapshot } from "../../../shared/ipc";

export const BOUNDARY_FEATURE = "agent-project-boundary";
export const EXTERNAL_GRANTS_FEATURE = "agent-external-grants";
export const DEFAULT_MAX_LINKS = 256;
export const DEFAULT_MAX_EXTERNAL = 256;

export interface DomainOption {
  key: DomainKey;
  kind: "project" | "agent";
  id: string;
  label: string;
}

export const projectDomain = (id: string): DomainKey => `project:${id}`;
export const agentDomain = (id: string): DomainKey => `agent:${id}`;

export function parseDomain(key: DomainKey): { kind: "project" | "agent"; id: string } | null {
  const m = /^(project|agent):(.+)$/.exec(key);
  return m ? { kind: m[1] as "project" | "agent", id: m[2]! } : null;
}

type Snapshot = Pick<SidebarSnapshot, "active" | "projects" | "hostRows"> | null | undefined;

/** Active projects, then active agents outside every project (independent agents, quick chats). */
export function domainOptions(sidebar: Snapshot): DomainOption[] {
  const projects = (sidebar?.projects?.projects ?? [])
    .filter((p) => (p.lifecycle ?? "active") === "active")
    .map((p): DomainOption => ({ key: projectDomain(p.project_id), kind: "project", id: p.project_id, label: p.presentation.display_name || p.project_id }));
  const agents = (sidebar?.active ?? [])
    .filter((s) => !sidebar?.hostRows[s.cutexSessionId]?.projectId)
    .map((s): DomainOption => ({ key: agentDomain(s.cutexSessionId), kind: "agent", id: s.cutexSessionId, label: s.displayName }));
  return [...projects, ...agents];
}

/** Display name of a domain (also for ones no longer listed: archived agents, removed projects). */
export function domainLabel(key: DomainKey, sidebar: Snapshot): { label: string; kind: "project" | "agent" | null; known: boolean } {
  const d = parseDomain(key);
  if (!d) return { label: key, kind: null, known: false };
  if (d.kind === "project") {
    const p = sidebar?.projects?.projects.find((x) => x.project_id === d.id);
    return { label: p?.presentation.display_name || d.id, kind: "project", known: !!p };
  }
  const s = [...(sidebar?.active ?? []), ...((sidebar as SidebarSnapshot | null)?.retired ?? [])].find((x) => x.cutexSessionId === d.id);
  return { label: s?.displayName ?? d.id, kind: "agent", known: !!s };
}

const linkKey = ([a, b]: readonly [DomainKey, DomainKey]) => [a, b].sort().join("\u0000");

export function sameLink(x: readonly [DomainKey, DomainKey], y: readonly [DomainKey, DomainKey]): boolean {
  return linkKey(x) === linkKey(y);
}

export type ListError = "self" | "duplicate" | "max";

/** The links with `a`–`b` added, or why cutex would refuse it. */
export function addLink(links: readonly [DomainKey, DomainKey][], a: DomainKey, b: DomainKey, max = DEFAULT_MAX_LINKS): [DomainKey, DomainKey][] | ListError {
  if (a === b) return "self";
  if (links.some((l) => sameLink(l, [a, b]))) return "duplicate";
  if (links.length >= max) return "max";
  return [...links, [a, b]];
}

export function removeLink(links: readonly [DomainKey, DomainKey][], link: readonly [DomainKey, DomainKey]): [DomainKey, DomainKey][] {
  return links.filter((l) => !sameLink(l, link));
}

/** Agents outside `projectId` that it could be granted, with the project each one is in (null = none). */
export function externalCandidates(sidebar: Snapshot, projectId: string, grants: readonly ExternalAgentGrant[]): { id: string; name: string; projectId: string | null; projectName: string | null }[] {
  const taken = new Set(grants.filter((g) => g.project === projectId).map((g) => g.agent));
  return (sidebar?.active ?? [])
    .filter((s) => sidebar?.hostRows[s.cutexSessionId]?.projectId !== projectId && !taken.has(s.cutexSessionId))
    .map((s) => {
      const pid = sidebar?.hostRows[s.cutexSessionId]?.projectId ?? null;
      const p = pid ? sidebar?.projects?.projects.find((x) => x.project_id === pid) : undefined;
      return { id: s.cutexSessionId, name: s.displayName, projectId: pid, projectName: pid ? (p?.presentation.display_name ?? pid) : null };
    })
    .sort((a, b) => Number(a.projectId !== null) - Number(b.projectId !== null) || a.name.localeCompare(b.name));
}

/**
 * Projects 协作 → 可见的外部 agent lists: only those with grants, in sidebar order (archived ones too
 * while they still hold grants), then project ids the sidebar does not know.
 */
export function grantedProjects(sidebar: Snapshot, grants: readonly ExternalAgentGrant[] | undefined): string[] {
  const granted = new Set((grants ?? []).map((g) => g.project));
  const known = (sidebar?.projects?.projects ?? []).map((p) => p.project_id);
  return [...known.filter((id) => granted.has(id)), ...[...granted].filter((id) => !known.includes(id))];
}

export function grantsFor(grants: readonly ExternalAgentGrant[] | undefined, projectId: string): ExternalAgentGrant[] {
  return (grants ?? []).filter((g) => g.project === projectId);
}

export function addGrant(grants: readonly ExternalAgentGrant[], projectId: string, agentId: string, max = DEFAULT_MAX_EXTERNAL): ExternalAgentGrant[] | ListError {
  if (grants.some((g) => g.project === projectId && g.agent === agentId)) return "duplicate";
  if (grants.length >= max) return "max";
  return [...grants, { project: projectId, agent: agentId }];
}

export function removeGrant(grants: readonly ExternalAgentGrant[], projectId: string, agentId: string): ExternalAgentGrant[] {
  return grants.filter((g) => !(g.project === projectId && g.agent === agentId));
}
