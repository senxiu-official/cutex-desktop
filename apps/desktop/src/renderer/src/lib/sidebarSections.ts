// Sidebar project sections (pure UI, device-local prefs `sidebarSections`; no daemon state). The
// owner names sections, moves projects into them and folds a section away (e.g. 「不重要」).
// Members are project host keys `hostKey(hostId, projectId)` (lib/hostKeys), so each host's entry
// of a same-named project is placed on its own in 所有设备 / group scopes. Sections are global
// (every scope sees the same list); a section without a member visible in the scope is hidden.
// Projects in no section render where they always did; sections follow below, in their order.
import { hostKey, parseHostKey } from "./hostKeys";
import type { SidebarGroup } from "./sidebar";
import type { GroupLayout } from "./sidebarLayout";

export interface SidebarSection {
  /** Stable id (not shown). */
  id: string;
  name: string;
  /** Folded: header only (with an attention summary). Ignored while searching. */
  collapsed: boolean;
  /** Project host keys, in the order they were added (display follows the sidebar's project order). */
  members: string[];
}

/** 分区收起时: header summary only, or also the projects that want the owner / hold the open agent. */
export type SectionCollapsedShows = "summary" | "attention";

/** A project's member key: its host key (groups without a host belong to `focus`). */
export function memberKey(group: Pick<SidebarGroup, "id" | "hostId">, focus: string): string {
  return hostKey(group.hostId ?? focus, group.id);
}

/** Sanitised `sidebarSections` from storage (unknown shapes dropped, members must be host keys, ids unique). */
export function migrateSections(value: unknown): SidebarSection[] {
  if (!Array.isArray(value)) return [];
  const out: SidebarSection[] = [];
  const ids = new Set<string>();
  const taken = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Partial<SidebarSection>;
    if (typeof s.id !== "string" || !s.id || ids.has(s.id) || typeof s.name !== "string") continue;
    ids.add(s.id);
    // A project sits in at most one section (the first one listing it wins).
    const members = (Array.isArray(s.members) ? s.members : []).filter((m): m is string => typeof m === "string" && parseHostKey(m) !== null && !taken.has(m));
    for (const m of members) taken.add(m);
    out.push({ id: s.id, name: s.name, collapsed: s.collapsed === true, members: [...new Set(members)] });
  }
  return out;
}

/** The section holding `key`, if any. */
export function sectionOf(sections: readonly SidebarSection[], key: string): SidebarSection | undefined {
  return sections.find((s) => s.members.includes(key));
}

export function newSectionId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** A new section named `name` (trimmed) holding `members` (taken out of any other section), appended. */
export function createSection(sections: readonly SidebarSection[], name: string, members: readonly string[] = [], id = newSectionId()): SidebarSection[] {
  const taken = new Set(members);
  const rest = sections.map((s) => (s.members.some((m) => taken.has(m)) ? { ...s, members: s.members.filter((m) => !taken.has(m)) } : s));
  return [...rest, { id, name: name.trim(), collapsed: false, members: [...taken] }];
}

/** `key` moved into section `sectionId` (null = out of every section). A section left with no members at all is removed. */
export function assignSection(sections: readonly SidebarSection[], key: string, sectionId: string | null): SidebarSection[] {
  const out: SidebarSection[] = [];
  for (const s of sections) {
    const has = s.members.includes(key);
    if (s.id === sectionId) out.push(has ? s : { ...s, members: [...s.members, key] });
    else if (!has) out.push(s);
    else if (s.members.length > 1) out.push({ ...s, members: s.members.filter((m) => m !== key) });
  }
  return out;
}

export function renameSection(sections: readonly SidebarSection[], id: string, name: string): SidebarSection[] {
  const trimmed = name.trim();
  return trimmed ? sections.map((s) => (s.id === id ? { ...s, name: trimmed } : s)) : [...sections];
}

/** Section removed; its projects go back to the unsectioned list. */
export function deleteSection(sections: readonly SidebarSection[], id: string): SidebarSection[] {
  return sections.filter((s) => s.id !== id);
}

export function setSectionCollapsed(sections: readonly SidebarSection[], id: string, collapsed: boolean): SidebarSection[] {
  return sections.map((s) => (s.id === id && s.collapsed !== collapsed ? { ...s, collapsed } : s));
}

/**
 * Section `id` moved one step up (-1) / down (+1) among `visible` (the section ids shown in this
 * scope, in order): it swaps places with its visible neighbour; hidden sections keep their slots.
 */
export function moveSection(sections: readonly SidebarSection[], id: string, step: -1 | 1, visible: readonly string[] = sections.map((s) => s.id)): SidebarSection[] {
  const at = visible.indexOf(id);
  const other = visible[at + step];
  if (at < 0 || other === undefined) return [...sections];
  const i = sections.findIndex((s) => s.id === id);
  const j = sections.findIndex((s) => s.id === other);
  if (i < 0 || j < 0) return [...sections];
  const out = [...sections];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

/** The groups split into the unsectioned ones and each section's (input order kept in both). */
export function splitBySection<G extends Pick<SidebarGroup, "id" | "hostId" | "kind">>(
  groups: readonly G[],
  sections: readonly SidebarSection[],
  focus: string,
): { rest: G[]; bySection: Map<string, G[]> } {
  const owner = new Map<string, string>();
  for (const s of sections) for (const m of s.members) if (!owner.has(m)) owner.set(m, s.id);
  const rest: G[] = [];
  const bySection = new Map<string, G[]>();
  for (const g of groups) {
    const id = g.kind === "project" ? owner.get(memberKey(g, focus)) : undefined;
    if (id === undefined) rest.push(g);
    else bySection.set(id, [...(bySection.get(id) ?? []), g]);
  }
  return { rest, bySection };
}

export interface SectionSummary {
  projects: number;
  needsYou: number;
  /** Agents that want the owner (needs-you / error / done). */
  attention: number;
  running: number;
  hasSelected: boolean;
}

/** What a folded section header shows so nothing important hides behind it. */
export function summarizeSection(layouts: readonly GroupLayout[]): SectionSummary {
  let needsYou = 0;
  let attention = 0;
  let running = 0;
  let hasSelected = false;
  for (const l of layouts) {
    needsYou += l.needsYouCount;
    attention += l.attentionCount;
    running += l.runningCount;
    hasSelected ||= l.hasSelected;
  }
  return { projects: layouts.length, needsYou, attention, running, hasSelected };
}

/**
 * The projects a section lists: all of them when open or while searching (matches auto-expand);
 * folded, none (`summary`) or only those that want the owner / hold the open agent (`attention`).
 */
export function visibleInSection(layouts: readonly GroupLayout[], collapsed: boolean, searching: boolean, shows: SectionCollapsedShows): GroupLayout[] {
  if (!collapsed || searching) return [...layouts];
  if (shows === "summary") return [];
  return layouts.filter((l) => l.attentionCount > 0 || l.hasSelected);
}
