// The look of a folder in the sidebar (owner folders, lib/sidebarSections, and the automatic 「更早的项目」;
// owner 2026-11-05): an icon and a colour, picked automatically and stably from the folder's id unless the owner
// chose them (folder menu 外观…, the section's `look`; owner 2026-11-06). The name is
// drawn in the colour's ink (styles.css `.folder-ink`, the project icons' ink rule: ≥ 4.5:1 on the sidebar in
// light and dark), its trailing line in the same colour at a lower strength. Hues from the project palette
// (lib/projectColors) whose ink passes in both themes; red is left out (it reads as an error). The owner picks
// from the same hues only (no free colour), so the ink rule holds for a chosen colour too.
import { Archive, Bookmark, Box, Briefcase, Flag, Folder, Layers, Shapes, Tag, type LucideIcon } from "lucide-react";
import { PROJECT_LUCIDE_ICONS } from "./projectIcons";

export const FOLDER_COLORS = ["#0D9488", "#F76B15", "#D6409F", "#8B5CF6", "#0EA5E9", "#A87956", "#64748B"] as const;
/** The colours' names (i18n `section.color.<name>`), in FOLDER_COLORS order. */
export const FOLDER_COLOR_NAMES = ["teal", "orange", "pink", "violet", "sky", "brown", "slate"] as const;
export const FOLDER_ICONS: readonly LucideIcon[] = [Folder, Layers, Briefcase, Box, Bookmark, Flag, Shapes, Tag];

/**
 * The icons the owner can choose (`id` is what gets stored): the automatic ones first, then the project icons
 * (lib/projectIcons; its `folder` is the same icon). Never the archive box, which marks 「更早的项目」.
 */
export const FOLDER_ICON_CHOICES: readonly { id: string; Icon: LucideIcon }[] = [
  ...(["folder", "layers", "briefcase", "box", "bookmark", "flag", "shapes", "tag"] as const).map((id, i) => ({ id, Icon: FOLDER_ICONS[i]! })),
  ...PROJECT_LUCIDE_ICONS.filter((p) => p.id !== "folder").map(({ id, Icon }) => ({ id, Icon })),
];

/** The owner's choice for a folder (`sidebarSections[].look`); a field left out stays automatic. */
export interface FolderLookChoice {
  color?: string;
  icon?: string;
}

/**
 * A stored choice kept as written (short strings only), so a choice a newer build made on another device survives
 * here; what this build does not know is drawn automatic (folderLook). Undefined when nothing is chosen.
 */
export function readFolderLookChoice(value: unknown): FolderLookChoice | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const ok = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 32;
  const out: FolderLookChoice = { ...(ok(v.color) && { color: v.color }), ...(ok(v.icon) && { icon: v.icon }) };
  return out.color || out.icon ? out : undefined;
}

/** The palette colour equal to `value` (any case), else null. */
export function folderColor(value: string | undefined): string | null {
  return FOLDER_COLORS.find((c) => c.toLowerCase() === value?.toLowerCase()) ?? null;
}

export function folderIcon(id: string | undefined): LucideIcon | null {
  return FOLDER_ICON_CHOICES.find((i) => i.id === id)?.Icon ?? null;
}

/** FNV-1a: the same folder id always gives the same look. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export interface FolderLook {
  color: string;
  icon: LucideIcon;
}

/** The owner's `choice` where this build knows it, the rest picked from the id. */
export function folderLook(id: string, choice?: FolderLookChoice): FolderLook {
  const h = hash(id);
  return {
    color: folderColor(choice?.color) ?? FOLDER_COLORS[h % FOLDER_COLORS.length]!,
    icon: folderIcon(choice?.icon) ?? FOLDER_ICONS[(h >>> 8) % FOLDER_ICONS.length]!,
  };
}

/**
 * The automatic 「更早的项目」 folder: slate (the palette's quiet one) and the archive icon, which no owner folder
 * gets (FOLDER_ICONS, FOLDER_ICON_CHOICES), so an owner folder of the same name never looks the same.
 */
export const OLDER_FOLDER_LOOK: FolderLook = { color: "#64748B", icon: Archive };
