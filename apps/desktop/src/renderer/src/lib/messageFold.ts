// Long-message folding (TODO "Long-message folding", owner-approved 2026-10-08): pure rules.
// A message is "long" when its rendered height exceeds N visual lines (height / line-height, not
// newline count). Auto-fold clips with CSS alone (max-height in `lh` units), so the first layout
// already has the final height and history-page scroll anchoring never sees a jump; measuring only
// decides whether the 展开全部 overlay shows and the M in 「共 M 行」.
import type { TimelineEntry } from "./timeline";

export const FOLD_LINE_OPTIONS = [8, 12, 20, 40] as const;
export type FoldLines = (typeof FOLD_LINE_OPTIONS)[number];
export const DEFAULT_FOLD_LINES: FoldLines = 12;
/** A short message folded by hand keeps this many lines (1 when it has no more than that). */
export const SHORT_FOLD_LINES = 3;
/** Extra clip height (in lines) so a few px of margin / descenders never count as a hidden line. */
export const FOLD_SLACK = 0.15;

export function migrateFoldLines(v: unknown): FoldLines {
  return (FOLD_LINE_OPTIONS as readonly unknown[]).includes(v) ? (v as FoldLines) : DEFAULT_FOLD_LINES;
}

/**
 * How a message takes part in folding: the user's own messages (incl. pending sends), the agent's
 * latest reply (never auto-folds), an older agent reply, or nothing (streaming text, other rows).
 */
export type FoldRole = "user" | "latest" | "older" | "off";

export interface FoldPrefs {
  foldLong: boolean;
  foldLines: number;
  foldOlderReplies: boolean;
}

/** Whether `role` folds by itself once taller than the threshold. */
export function autoFolds(role: FoldRole, prefs: FoldPrefs): boolean {
  if (!prefs.foldLong) return false;
  if (role === "user") return true;
  if (role === "older") return prefs.foldOlderReplies;
  return false;
}

/** Visual lines of a block `height` px tall with `lineHeight` px lines (≥ 1). */
export function visualLines(height: number, lineHeight: number): number {
  if (!(lineHeight > 0) || !(height > 0)) return 1;
  return Math.max(1, Math.ceil(height / lineHeight - FOLD_SLACK));
}

/** A computed `line-height` in px ("normal" ≈ 1.2 × font size). */
export function lineHeightPx(lineHeight: string, fontSize: string): number {
  const lh = parseFloat(lineHeight);
  if (Number.isFinite(lh) && lh > 0 && lineHeight.endsWith("px")) return lh;
  const fs = parseFloat(fontSize);
  if (Number.isFinite(lh) && lh > 0 && Number.isFinite(fs)) return lh * fs; // unitless
  return (Number.isFinite(fs) && fs > 0 ? fs : 14) * 1.2;
}

/** A manual choice from the hover menu / buttons; absent = follow the settings. */
export type FoldManual = "folded" | "open";

export interface FoldView {
  /** Clip to this many lines (null = full height). Known before measuring for auto-fold. */
  clipLines: number | null;
  /** Clipped and something is hidden: show the fade + 「展开全部（共 M 行）」. */
  overflowing: boolean;
  /** Shown in full but long, and the user opened it (or it would auto-fold): sticky + end 「收起」. */
  collapsible: boolean;
  /** The hover menu can fold it (shown in full, more than one line). */
  canFold: boolean;
}

/** `lines`: measured visual lines, 0 while not measured yet. */
export function foldView(auto: boolean, manual: FoldManual | undefined, lines: number, threshold: number): FoldView {
  let clipLines: number | null = null;
  if (manual === "folded") clipLines = lines > threshold ? threshold : lines > SHORT_FOLD_LINES ? SHORT_FOLD_LINES : 1;
  else if (manual !== "open" && auto) clipLines = threshold;
  const overflowing = clipLines !== null && lines > clipLines;
  const long = lines > threshold;
  return {
    clipLines,
    overflowing,
    collapsible: clipLines === null && long && (auto || manual === "open"),
    canFold: clipLines === null && lines > 1,
  };
}

/**
 * Agent messages of the latest reply: those of the newest turn that has agent text. They never
 * auto-fold, so a turn's commentary does not fold away while its next message streams in.
 */
export function latestReplyIds(entries: readonly TimelineEntry[]): Set<string> {
  const out = new Set<string>();
  let turn: string | null | undefined;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind !== "agent") continue;
    if (turn === undefined) turn = e.turnId ?? null;
    else if ((e.turnId ?? null) !== turn || turn === null) break;
    out.add(e.id);
  }
  return out;
}
