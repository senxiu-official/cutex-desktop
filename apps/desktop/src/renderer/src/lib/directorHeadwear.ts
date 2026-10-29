// The Director's headwear (owner 2026-10-24, .claude/previews/preview-tray-notes-badges.html v2 §3 and the owner-fitted
// .claude/previews/preview-maid-fit.html): a transparent picture worn on the avatar of an agent that is its project's
// Director, wherever that avatar is drawn at HEADWEAR_MIN_AVATAR px or more (components/Avatar). Settings → 外观 →
// 主管头饰 picks the style (UiPrefs.directorHeadwear); 不显示 turns it off.
//
// Styles: maid (default), crown, 冕冠 (2026-10-25, art .claude/previews/headwear), and detective, graduation, chef,
// wizard, halo, cat ears, headphones (2026-10-25, art .claude/previews/headwear-more). Two more rules (same day):
// - 副主管也戴 (UiPrefs.operatorHeadwear): a project's Operator wears the smaller companion of the Director's style —
//   maid → a three-lobe maid band, crown → a tiara, 冕冠 → a hairpin (that one only from 40 px: smaller it reads as a
//   red dot). Styles without a companion leave Operators bare. An agent that is both is a Director (lib/agentLook).
// - 节日头饰 (UiPrefs.seasonalHeadwear): Dec 20–26 → a Christmas hat; Lunar New Year's eve through the 15th day → a
//   red bow; for the Director only, over the chosen style, by the local calendar date; back to the style after.
//
// The fit is relative to the avatar's diameter d: width w d, height h d, centred (plus x d), its top `top` d from the
// avatar's top edge (negative = above it). Maid is the owner's saved fit (`maid-headwear-fit`). The others keep their
// picture's aspect ratio and are placed by where their lower edge meets the head: crowns and caps a little into the
// avatar, the halo floating 0.10 d above it, the headphones' band over the head with the cups beside the face.
import { useEffect, useState } from "react";

/** 主管头饰: a style, or none. The first is the default. */
export const DIRECTOR_HEADWEARS = ["maid", "crown", "mianguan", "detective", "graduation", "chef", "wizard", "halo", "cat-ears", "headphones", "none"] as const;
export type DirectorHeadwear = (typeof DIRECTOR_HEADWEARS)[number];
export type HeadwearStyle = Exclude<DirectorHeadwear, "none">;
export const DEFAULT_DIRECTOR_HEADWEAR: DirectorHeadwear = "maid";

export type OperatorHeadwear = "operator-maid" | "operator-tiara" | "operator-hairpin";
export type SeasonalHeadwear = "christmas" | "lunar-new-year";
/** Every picture an avatar can wear. */
export type HeadwearPicture = HeadwearStyle | OperatorHeadwear | SeasonalHeadwear;

/** Avatars smaller than this (px) wear nothing (a 20 px row would be all hat). */
export const HEADWEAR_MIN_AVATAR = 28;

export interface HeadwearFit {
  /** Width / height in avatar diameters. */
  w: number;
  h: number;
  /** The top edge's offset from the avatar's top, in diameters (negative = above it). */
  top: number;
  /** Horizontal offset after centring, in diameters (positive = right). */
  x: number;
}

/** A fit from its width, the picture's aspect (width / height) and where its lower edge sits (d below the avatar's top). */
function seated(w: number, aspect: number, bottom: number, x = 0): HeadwearFit {
  const h = Math.round((w / aspect) * 1000) / 1000;
  return { w, h, top: Math.round((bottom - h) * 1000) / 1000, x };
}

/** Per picture: its fit (pictures: 512 px wide masters, the aspect below) and the least avatar size it shows at. */
const FITS: Record<HeadwearPicture, { fit: HeadwearFit; min?: number }> = {
  maid: { fit: { w: 1.12, h: 0.7, top: -0.14, x: 0 } },
  // 512 × 238: 0.80 d wide, its band's lower edge 0.10 d below the avatar's top.
  crown: { fit: { w: 0.8, h: 0.372, top: -0.272, x: 0 } },
  // 512 × 148: 1.22 d wide; the board above the head, the cap's rim on its top, the beads below.
  mianguan: { fit: { w: 1.22, h: 0.353, top: -0.223, x: 0 } },
  // Companions: about two thirds of the Director's width, on the head's top.
  "operator-maid": { fit: seated(0.64, 512 / 181, 0.08) },
  "operator-tiara": { fit: seated(0.64, 512 / 145, 0.08) },
  "operator-hairpin": { fit: seated(0.68, 512 / 228, 0.1), min: 40 },
  christmas: { fit: seated(1.05, 512 / 269, 0.14) },
  "lunar-new-year": { fit: seated(0.76, 512 / 268, 0.12) },
  detective: { fit: seated(1.07, 512 / 234, 0.17) },
  graduation: { fit: seated(1.12, 512 / 221, 0.18) },
  chef: { fit: seated(0.94, 512 / 310, 0.14) },
  wizard: { fit: seated(1.08, 512 / 360, 0.14) },
  halo: { fit: seated(0.84, 512 / 120, -0.1) },
  "cat-ears": { fit: seated(1.05, 512 / 156, 0.13) },
  // The band 0.08 d above the head; the cups reach 0.78 d down, at the sides of the face.
  headphones: { fit: seated(1.14, 512 / 386, 0.78) },
};

/** The Operator's companion of each Director style (styles not listed: none). */
export const OPERATOR_COMPANION: Partial<Record<HeadwearStyle, OperatorHeadwear>> = {
  maid: "operator-maid",
  crown: "operator-tiara",
  mianguan: "operator-hairpin",
};

// Vite's URLs of the pictures at 64 / 128 / 512 px wide (assets/headwear/<picture>-<width>.png).
const URLS = import.meta.glob<string>("../assets/headwear/*.png", { eager: true, query: "?url", import: "default" });
const WIDTHS = [64, 128, 512] as const;
function sourcesOf(picture: HeadwearPicture): (readonly [number, string])[] {
  return WIDTHS.map((w) => [w, URLS[`../assets/headwear/${picture}-${w}.png`] ?? ""] as const).filter(([, url]) => url);
}

/** A stored value read back: a known style or none; anything else = the default. */
export function migrateDirectorHeadwear(v: unknown): DirectorHeadwear {
  return (DIRECTOR_HEADWEARS as readonly unknown[]).includes(v) ? (v as DirectorHeadwear) : DEFAULT_DIRECTOR_HEADWEAR;
}

export interface HeadwearRole {
  isDirector: boolean;
  isOperator?: boolean;
}

export interface HeadwearOptions {
  /** 副主管也戴 (default on). */
  operators?: boolean;
  /** Today's festival picture (seasonalHeadwear), when 节日头饰 is on. */
  seasonal?: SeasonalHeadwear | null;
}

/**
 * What an avatar of diameter `size` wears: a picture, or null (no role, turned off, too small). The Director wears the
 * festival picture in its window, else the style; an Operator the style's companion. 不显示 turns all of it off. Pure.
 */
export function headwearFor(setting: DirectorHeadwear, role: HeadwearRole, size: number, options: HeadwearOptions = {}): HeadwearPicture | null {
  if (setting === "none" || size < HEADWEAR_MIN_AVATAR) return null;
  let picture: HeadwearPicture | null = null;
  if (role.isDirector) picture = options.seasonal ?? setting;
  else if (role.isOperator && options.operators !== false) picture = OPERATOR_COMPANION[setting] ?? null;
  if (!picture) return null;
  return size >= (FITS[picture].min ?? HEADWEAR_MIN_AVATAR) ? picture : null;
}

/** Where the picture goes in the avatar's box (px, relative to its top-left). Pure. */
export function headwearBox(picture: HeadwearPicture, size: number): { left: number; top: number; width: number; height: number } {
  const { w, h, top, x } = FITS[picture].fit;
  const width = w * size;
  return { left: (size - width) / 2 + x * size, top: top * size, width, height: h * size };
}

/** The picture's `src` (the smallest) and `srcset` (by width). */
export function headwearSources(picture: HeadwearPicture): { src: string; srcSet: string } {
  const sources = sourcesOf(picture);
  return { src: sources[0]?.[1] ?? "", srcSet: sources.map(([w, url]) => `${url} ${w}w`).join(", ") };
}

/** The fit of a picture (tests, the settings preview). */
export function headwearFit(picture: HeadwearPicture): HeadwearFit {
  return FITS[picture].fit;
}

// Lunar New Year's day (month, day) by Gregorian year: the 1st day of the 1st lunar month (Chinese calendar). The
// festival window is the eve (the day before) through the 15th day (元宵). No network: extend the table by 2035.
export const LUNAR_NEW_YEAR: Readonly<Record<number, readonly [number, number]>> = {
  2026: [2, 17],
  2027: [2, 6],
  2028: [1, 26],
  2029: [2, 13],
  2030: [2, 3],
  2031: [1, 23],
  2032: [2, 11],
  2033: [1, 31],
  2034: [2, 19],
  2035: [2, 8],
};
const DAY_MS = 86_400_000;

/** The festival picture for `now`'s LOCAL calendar date, or null. Pure. */
export function seasonalHeadwear(now: Date): SeasonalHeadwear | null {
  const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
  if (m === 12 && d >= 20 && d <= 26) return "christmas";
  const lny = LUNAR_NEW_YEAR[y];
  if (!lny) return null;
  // Whole days between two calendar dates (UTC day numbers: no DST hour in between).
  const offset = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, lny[0] - 1, lny[1])) / DAY_MS);
  return offset >= -1 && offset <= 14 ? "lunar-new-year" : null;
}

/** Milliseconds from `now` to the next local midnight. */
export function msToLocalMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(1_000, next.getTime() - now.getTime());
}

// One timer for every avatar: today's festival picture, refreshed at local midnight (and when the window wakes).
let today: SeasonalHeadwear | null = seasonalHeadwear(new Date());
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
function refresh() {
  const next = seasonalHeadwear(new Date());
  if (next !== today) {
    today = next;
    for (const l of listeners) l();
  }
}
function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    refresh();
    schedule();
  }, msToLocalMidnight(new Date()) + 1_000);
}

/** Today's festival picture when 节日头饰 is on (re-renders when the date crosses into or out of a window). */
export function useSeasonalHeadwear(enabled: boolean): SeasonalHeadwear | null {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const listener = () => bump((n) => n + 1);
    listeners.add(listener);
    if (listeners.size === 1) {
      refresh();
      schedule();
      document.addEventListener("visibilitychange", refresh);
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        if (timer) clearTimeout(timer);
        timer = null;
        document.removeEventListener("visibilitychange", refresh);
      }
    };
  }, [enabled]);
  return enabled ? today : null;
}
