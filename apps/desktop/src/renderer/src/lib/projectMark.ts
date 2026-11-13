// The project mark on a Director's avatar (owner 2026-10-23, option (a) of the avatar-marks preview): 1–4 columns
// at the avatar's bottom-left, drawn as the sidebar header's project tile (components/ProjectMarkChip). The text is what that icon shows:
// the chosen text / emoji icon (prefs `projectIcons`), else the project's badge label, else the first characters of
// its name (a CJK name: one character; Latin: two capitals). A Director of several projects, or of none: no mark.
import { clipToWidth, displayWidth } from "./badgeWidth";
import { graphemes } from "./graphemes";
import { mixHex, readableInk, SIDEBAR_BACKGROUNDS } from "./folderInk";
import type { ProjectIconChoice } from "./projectIcons";

/** The most display columns a mark shows: all a wide cutex badge label holds (project-badge-wide; CJK 2, Latin 1), so
 *  「CT副」, 「副总」 or 「ABCD」 show whole (owner 2026-10-26: 「CT副」 used to lose its 副). */
export const PROJECT_MARK_MAX_WIDTH = 4;

/** Avatars smaller than this (px) carry no mark. */
export const PROJECT_MARK_MIN_AVATAR = 24;

const CJK = /[⺀-鿿豈-﫿＀-￯]/u;

/** The name split at word boundaries (-, _, ., /, spaces, camelCase), empties dropped. */
function words(name: string): string[] {
  return name
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s\-_./\\]+/u)
    .filter(Boolean);
}

/** The name's initials: one CJK character; else the first letters of the first two words ("cutex-desktop" → CD,
 *  "sc-polya-v2" → SP); a one-word name takes its first two letters ("cutex" → CU). */
export function nameMark(name: string): string {
  const w = words(name);
  if (!w.length) return "";
  if (CJK.test([...w[0]!][0]!)) return [...w[0]!][0]!;
  const first = [...w[0]!];
  if (w.length > 1) return (first[0]! + [...w[1]!][0]!).toUpperCase();
  return first.slice(0, 2).join("").toUpperCase();
}

/** A badge label the owner set on purpose: not just the name's first two characters (what 新建项目 fills in). */
function deliberateBadge(badge: string, name: string): boolean {
  const b = badge.trim();
  if (!b) return false;
  return b.toUpperCase() !== [...name.trim()].slice(0, 2).join("").toUpperCase() && b.toUpperCase() !== [...name.trim()][0]?.toUpperCase();
}

/** The mark before de-duplication: a deliberate badge label, else the name's initials. */
export function baseMark(name: string, badge: string | null | undefined): string {
  const b = (badge ?? "").trim();
  return deliberateBadge(b, name) ? clipToWidth(b, PROJECT_MARK_MAX_WIDTH) : nameMark(name);
}

/** Next-best marks for a name whose first choice is taken: first letter + a later letter of the name, then a lone letter. */
function alternatives(name: string): string[] {
  const letters = [...name.toUpperCase()].filter((c) => /[\p{L}\p{N}]/u.test(c));
  const out: string[] = [];
  const w = words(name).map((x) => [...x.toUpperCase()]);
  if (w.length > 1) for (const c of w[1]!.slice(1)) out.push(w[0]![0]! + c);
  for (const c of letters.slice(1)) out.push(letters[0]! + c);
  if (letters[0]) out.push(letters[0]);
  return out;
}

/** Marks for the projects on screen, no two alike: in key order each takes its base mark, or the next
 *  distinguishing one ("cutex-desktop" CD, "cutex-docs" → CO). */
export function distinctMarks(projects: readonly { key: string; name: string; badge?: string | null }[]): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const p of [...projects].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    const base = baseMark(p.name, p.badge);
    const pick = [base, ...alternatives(p.name)].find((m) => m && !used.has(m.toUpperCase())) ?? base;
    used.add(pick.toUpperCase());
    out.set(p.key, pick);
  }
  return out;
}

/** The mark's text for a project: the owner's text / emoji icon, else `auto` (its distinct mark). */
export function projectMarkText(icon: ProjectIconChoice | null | undefined, auto: string): string {
  const own = icon && (icon.kind === "text" || icon.kind === "emoji") ? icon.value.trim() : "";
  return clipToWidth(own || auto, PROJECT_MARK_MAX_WIDTH);
}

/** Mark box height for an avatar of `size` px: 12 from 24, 13 from 32, 14 from 44. */
export function projectMarkHeight(size: number): number {
  return size >= 44 ? 14 : size >= 32 ? 13 : 12;
}

/** Mark text size (px) in a box of `height`: Latin 8.5 / 9 / 9.5 in the code font; text with a CJK (wide) character takes
 *  the box minus 2 px in the UI font — hanzi below 10 px blur into a blot, and the UI font's narrower Latin keeps 「CT副」 short.
 *  `crowded` (projectMarkCrowded): a hanzi half a px less, and Latin in the narrower UI font too. */
export function projectMarkFont(height: number, text: string, crowded = false): { size: number; sans: boolean } {
  const wide = displayWidth(text) > graphemes(text).length;
  return { size: wide ? height - (crowded ? 2.5 : 2) : height >= 14 ? 9.5 : height >= 13 ? 9 : 8.5, sans: wide || crowded };
}

/** A mark of more than two columns (「CT副」, 「ABCD」) on an avatar under 36 px with a presence dot would reach the dot's cut
 *  ring (measured 2026-10-26): it is drawn tighter (projectMarkFont), with 1 px padding, 2 px further out left. */
export function projectMarkCrowded(size: number, text: string, dot: boolean): boolean {
  return dot && size < 36 && displayWidth(text) > 2;
}

/** Corner radius (px) of the rectangular mark. */
export const MARK_RADIUS = 3;

/** WCAG AA for the mark's 8.5–12 px text. */
export const MARK_MIN_CONTRAST = 4.5;

/** What a mark is drawn from: its text and a project colour (a palette name or #hex, lib/sidebar projectColor). */
export interface AvatarMark {
  text: string;
  color: string;
  /** The project's lucide icon (presentation.icon kind `icon`), drawn instead of `text` when the catalog has it;
   *  `text` stays the letters for an id this desktop cannot draw. Text / emoji icons already are `text`. */
  icon?: ProjectIconChoice | null;
}

/** The mark an avatar carries (owner 2026-10-27): the agent's own badge (cutex `badge`, set from the tray's 徽章… or
 *  编辑信息) is drawn as the project mark is — same place, box and font rules, at most PROJECT_MARK_MAX_WIDTH columns.
 *  On a Director it replaces the project's text and keeps the project's colour (it still marks the project); on any
 *  other agent it takes the badge's own tint. No badge: the project mark (or none). */
export function avatarMark(project: AvatarMark | null, badge: AvatarMark | null): AvatarMark | null {
  const own = badge ? clipToWidth(badge.text.trim(), PROJECT_MARK_MAX_WIDTH) : "";
  if (own) return { text: own, color: project?.color ?? badge!.color };
  return project?.text ? project : null;
}

/** Whether an avatar of `size` px draws a mark (components/Avatar: not a minor tile, not a cut-out portrait). A list
 *  that shows the badge as a chip beside the name drops that chip when the avatar carries it. */
export function avatarCarriesMark(size: number): boolean {
  return size >= PROJECT_MARK_MIN_AVATAR;
}

/** What a mark's tile is laid over, per theme family: every palette's card and surface (lib/folderInk SIDEBAR_BACKGROUNDS)
 *  and its --surface-2 (styles.css), where the colour picker previews the chip (cross-review 2026-11-13: dark olive +
 *  #ff11bb read 4.0:1 there). */
export const MARK_BACKGROUNDS = {
  light: [...SIDEBAR_BACKGROUNDS.light, "#ececee", "#e8e5da", "#e6e6e3"],
  dark: [...SIDEBAR_BACKGROUNDS.dark, "#262628", "#313130", "#353534", "#363633", "#363332", "#18181a"],
} as const;
/** The mark's tile strength per theme family: styles.css `--project-icon-tint` (the sidebar's project icon). */
export const MARK_TILE_TINT = { light: 0.14, dark: 0.18 } as const;
/** Where the mark's ink starts (toward black / white): a step past the sidebar's `--project-icon-ink`, since the
 *  mark's 8.5–9.5 px text is smaller than the sidebar's and must reach MARK_MIN_CONTRAST on a portrait's corner. */
const MARK_TILE_INK_START = { light: 0.36, dark: 0.24 } as const;
const tileInks = new Map<string, { light: string; dark: string }>();

/** The mark's ink of project colour `hex` for light and dark themes: from the start mix further toward black /
 *  white until it reads INK_TARGET (≥ 4.5:1) on the tile over every MARK_BACKGROUNDS colour, so a pale
 *  yellow in light themes or a deep violet in dark ones still reads (2026-11-12: the sidebar's own ink gave 3.4:1 there). */
export function markTileInks(hex: string): { light: string; dark: string } {
  const key = hex.toLowerCase();
  let inks = tileInks.get(key);
  if (!inks) {
    const ink = (theme: "light" | "dark") => readableInk(key, theme, MARK_TILE_INK_START[theme], MARK_BACKGROUNDS[theme].map((bg) => mixHex(bg, key, MARK_TILE_TINT[theme])));
    inks = { light: ink("light"), dark: ink("dark") };
    tileInks.set(key, inks);
  }
  return inks;
}
