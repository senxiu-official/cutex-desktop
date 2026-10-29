// Project labels use 1..=2 columns on old hosts, 1..=4 with project-badge-wide. Session badges use 1..=4.
// Width like cutex UnicodeWidthStr: CJK / fullwidth / emoji count 2, the rest 1
// (combining marks 0).
// New daemons advertise project-badge-wide; older hosts retain their two-column limit.
import { graphemes } from "./graphemes";
export const BADGE_MAX_WIDTH = 2;
export const projectBadgeWidth = (features: ReadonlySet<string>): number => features.has("project-badge-wide") ? 4 : 2;

const WIDE: [number, number][] = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653],
  [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce],
  [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705],
  [0x270a, 0x270b], [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55], [0x2e80, 0x303e], [0x3041, 0x33ff],
  [0x3400, 0x4dbf], [0x4e00, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f],
  [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff], [0x1f900, 0x1f9ff], [0x1fa70, 0x1faff],
  [0x20000, 0x3fffd],
];

/** Display columns of one code point. */
export function charWidth(ch: string): number {
  const c = ch.codePointAt(0)!;
  if (c === 0 || (c >= 0x300 && c <= 0x36f) || c === 0x200d || (c >= 0xfe00 && c <= 0xfe0f)) return 0;
  return WIDE.some(([a, b]) => c >= a && c <= b) ? 2 : 1;
}

/** One visible grapheme: CJK/emoji use two columns, Latin one; never count a ZWJ emoji twice. */
function clusterWidth(cluster: string): number {
  if (/[\p{Emoji_Presentation}\uFE0F\u20E3]/u.test(cluster)) return 2;
  return Math.max(0, ...Array.from(cluster, (ch) => /\p{Mark}/u.test(ch) ? 0 : charWidth(ch)));
}
/** Display columns of `text`, counting whole visible grapheme clusters. */
export function displayWidth(text: string): number {
  let w = 0;
  for (const ch of graphemes(text)) w += clusterWidth(ch);
  return w;
}

/** `text` cut to at most `max` columns (whole characters). */
export function clipToWidth(text: string, max = BADGE_MAX_WIDTH): string {
  let w = 0;
  let out = "";
  for (const ch of graphemes(text)) {
    const n = clusterWidth(ch);
    if (w + n > max) break;
    w += n;
    out += ch;
  }
  return out;
}

/** True when cutex's refusal is about the badge label. */
export function isBadgeLabelError(e: unknown): boolean {
  return (e instanceof Error ? e.message : String(e)).includes("invalid_project_badge_label");
}
