// The look of a folder in the sidebar (owner folders, lib/sidebarSections, and the automatic 「更早的项目」;
// owner 2026-11-05): an icon and a colour, picked automatically and stably from the folder's id unless the owner
// chose them (folder menu 外观…, the section's `look`; owner 2026-11-06). The name is
// drawn in the colour's ink (styles.css `.folder-ink`, the project icons' ink rule: ≥ 4.5:1 on the sidebar in
// light and dark), its trailing line in the same colour at a lower strength. Automatic picks use only the hues
// below whose ink passes in both themes, without red (it reads as an error); FOLDER_COLORS and FOLDER_ICONS feed the
// hash, so they never change. By hand the owner may pick any colour (red included, the extra swatches or a custom
// one): its ink is derived per theme (lib/folderInk) so the name still reads ≥ 4.5:1, and any icon of
// lib/folderIcons.
import { Archive, Bookmark, Box, Briefcase, Flag, Folder, Layers, Shapes, Tag, type LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { FOLDER_ICON_BY_ID } from "./folderIcons";
import { folderInks } from "./folderInk";
import { PROJECT_LUCIDE_ICONS } from "./projectIcons";

export const FOLDER_COLORS = ["#0D9488", "#F76B15", "#D6409F", "#8B5CF6", "#0EA5E9", "#A87956", "#64748B"] as const;
/** The colours' names (i18n `section.color.<name>`), in FOLDER_COLORS order. */
export const FOLDER_COLOR_NAMES = ["teal", "orange", "pink", "violet", "sky", "brown", "slate"] as const;
/** More swatches for picking by hand only (never automatic), with their i18n names. */
export const FOLDER_EXTRA_COLORS = [
  ["red", "#DC2626"], ["rose", "#E11D48"], ["amber", "#D97706"], ["yellow", "#CA8A04"], ["lime", "#65A30D"], ["green", "#16A34A"],
  ["emerald", "#059669"], ["cyan", "#0891B2"], ["blue", "#2563EB"], ["indigo", "#4F46E5"], ["fuchsia", "#C026D3"], ["stone", "#78716C"],
] as const;
export const FOLDER_ICONS: readonly LucideIcon[] = [Folder, Layers, Briefcase, Box, Bookmark, Flag, Shapes, Tag];

/**
 * The icons of the first version of 外观… (`id` is what got stored): the automatic ones, then the project icons
 * (lib/projectIcons; its `folder` is the same icon). Kept so those choices keep resolving next to lib/folderIcons.
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

/** `#RGB` / `#RRGGBB` (any case, spaces around ignored) as `#RRGGBB`, else null. */
export function cleanFolderColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (short) return `#${short.slice(1).map((d) => d + d).join("")}`.toUpperCase();
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : null;
}

/**
 * A stored choice as read from local prefs or the synced layout: the colour only as `#RRGGBB` (anything else is
 * dropped, so the folder is drawn automatic), the icon as any short id (one a newer build added survives here and is
 * drawn automatic). Undefined when nothing is chosen.
 */
export function readFolderLookChoice(value: unknown): FolderLookChoice | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const color = cleanFolderColor(v.color);
  const icon = typeof v.icon === "string" && v.icon.length > 0 && v.icon.length <= 32 ? v.icon : null;
  const out: FolderLookChoice = { ...(color && { color }), ...(icon && { icon }) };
  return out.color || out.icon ? out : undefined;
}

/** A chosen colour as `#RRGGBB` (any valid hex), else null. */
export function folderColor(value: string | undefined): string | null {
  return cleanFolderColor(value);
}

export function folderIcon(id: string | undefined): LucideIcon | null {
  if (!id) return null;
  return FOLDER_ICON_BY_ID.get(id) ?? FOLDER_ICON_CHOICES.find((i) => i.id === id)?.Icon ?? null;
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
  /** The name's ink per theme for a colour outside FOLDER_COLORS (lib/folderInk); the palette's keep the CSS rule. */
  ink?: { light: string; dark: string };
}

/** The owner's `choice` where this build knows it, the rest picked from the id. */
export function folderLook(id: string, choice?: FolderLookChoice): FolderLook {
  const h = hash(id);
  const chosen = folderColor(choice?.color);
  const color = chosen ?? FOLDER_COLORS[h % FOLDER_COLORS.length]!;
  return {
    color,
    icon: folderIcon(choice?.icon) ?? FOLDER_ICONS[(h >>> 8) % FOLDER_ICONS.length]!,
    ...(chosen && !(FOLDER_COLORS as readonly string[]).includes(chosen) && { ink: folderInks(chosen) }),
  };
}

/** The CSS variables a folder's header (or the dialog's preview) needs for `.folder-ink` / `.folder-line`. */
export function folderStyle(look: FolderLook): CSSProperties {
  return { "--folder-color": look.color, ...(look.ink ? { "--folder-ink-light": look.ink.light, "--folder-ink-dark": look.ink.dark } : { "--folder-ink-light": "initial", "--folder-ink-dark": "initial" }) } as CSSProperties;
}

/**
 * The automatic 「更早的项目」 folder: slate (the palette's quiet one) and the archive icon, which no owner folder
 * gets (FOLDER_ICONS, FOLDER_ICON_CHOICES, lib/folderIcons), so an owner folder of the same name never looks the same.
 */
export const OLDER_FOLDER_LOOK: FolderLook = { color: "#64748B", icon: Archive };
