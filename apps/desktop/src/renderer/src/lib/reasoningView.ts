// Settings → 推理过程: how reasoning steps show in the timeline. Pure.
export const REASONING_VIEWS = ["expanded", "collapsed", "hidden"] as const;
export type ReasoningView = (typeof REASONING_VIEWS)[number];

/** Folded to their one-line row by default, also while streaming (owner, 2026-10-08). */
export const DEFAULT_REASONING_VIEW: ReasoningView = "collapsed";
/** Bumped when the default changed: prefs saved before rev 2 hold the old default "expanded"
 *  (every save writes the whole prefs object), so it can't tell a choice from the default. */
export const REASONING_VIEW_REV = 2;

/** Stored value → view; a pre-rev-2 "expanded" (the old default) becomes the new default once. */
export function migrateReasoningView(v: unknown, rev: unknown): ReasoningView {
  if (!(REASONING_VIEWS as readonly unknown[]).includes(v)) return DEFAULT_REASONING_VIEW;
  if (v === "expanded" && (typeof rev !== "number" || rev < REASONING_VIEW_REV)) return DEFAULT_REASONING_VIEW;
  return v as ReasoningView;
}
