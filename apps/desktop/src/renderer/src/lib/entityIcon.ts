// What components/EntityIcon draws, and the slot a list gives its rows (outside the component file for Fast Refresh).
import type { AvatarProfile } from "../components/ProfileAvatar";
import { projectBadgeWidth } from "./projectBadgeSize";
import { projectIcon, type ProjectIconChoice } from "./projectIcons";

/**
 * What a row or sentence names. A project without `badge` / `color` and a Profile without `profile` (only its name or
 * id in `ref`) are looked up when drawn: the host's sidebar snapshot, lib/profileLooks (the lists the app loads anyway).
 */
export type EntityRef =
  | { kind: "agent"; id: string; name: string }
  | { kind: "project"; id: string; hostId: string; badge?: string; color?: string }
  | { kind: "profile"; profile?: AvatarProfile; ref?: string; hostId?: string };

/** An option of components/EntitySelect (a select whose options name projects, agents or Profiles). */
export type EntitySelectOption = { value: string; label: string; disabled?: boolean; group?: string; entity?: EntityRef | null; searchText?: string };

/** Icon box per row size: 16 = a text line (pickers, chips, lists), 18 = sidebar-sized rows, 22 = page lists. */
export type EntityIconSize = 16 | 18 | 22;
export const ENTITY_PROJECT_SIZE = { 16: "md", 18: "sm", 22: "lg" } as const;

/** The widest icon of `entities` at `size` (px): the slot a list gives every row so the names line up. */
export function entityIconSlot(entities: readonly (EntityRef | null | undefined)[], icons: Readonly<Record<string, ProjectIconChoice>>, size: EntityIconSize = 16): number {
  let slot: number = size;
  for (const entity of entities) {
    if (entity?.kind !== "project") continue;
    slot = Math.max(slot, projectBadgeWidth(projectIcon(icons, entity.hostId, entity.id), entity.badge ?? "?", ENTITY_PROJECT_SIZE[size]));
  }
  return slot;
}

/** A sidebar project (ProjectSummary) as an entity: its badge falls back to the name's first letter, as on the sidebar. */
export function projectEntity(hostId: string, project: { project_id: string; presentation: { badge_label?: string | null; color: string; display_name: string } }): EntityRef {
  const p = project.presentation;
  return { kind: "project", id: project.project_id, hostId, badge: p.badge_label || (p.display_name || project.project_id).slice(0, 1), color: p.color };
}
