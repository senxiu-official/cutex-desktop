// Click-twice confirmation for destructive actions inside a card (goal 清除, paused queue 清空):
// the first click "arms" — the whole card turns red, the other actions hide, a hint says "click
// again" — and it disarms by itself after a few seconds. One look everywhere, no modal dialogs.
import { useEffect, useState } from "react";

export const ARMED_TIMEOUT_MS = 3000;
/** Card frame while armed (border + tint); the card keeps its own size/padding classes. */
export const ARMED_FRAME = "border-danger/70 bg-danger/5";
/** The confirming button while armed. */
export const ARMED_BUTTON = "rounded-md bg-danger px-2 py-0.5 text-xs text-white";
/** The confirming button where it replaces a settings `Button` (Form.tsx): same border and padding. */
export const ARMED_FORM_BUTTON = "rounded-md border border-danger bg-danger px-3 py-1 text-xs text-white disabled:opacity-40";

/** `armed` resets after ARMED_TIMEOUT_MS, or immediately when `resetKey` changes. */
export function useArmed(resetKey?: unknown): [boolean, (armed: boolean) => void] {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), ARMED_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  useEffect(() => setArmed(false), [resetKey]);
  return [armed, setArmed];
}

/** Gap between an armed button and its hint bubble, and the bubble's minimum distance to the viewport edge. */
const HINT_GAP = 6;
const HINT_MARGIN = 8;

export interface HintRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

/**
 * Where the ArmedHint bubble goes (viewport px, position: fixed): above the button when it fits,
 * else below; centred on it and clamped into the viewport, so the hint never moves the button.
 */
export function armedHintPosition(anchor: HintRect, bubble: { width: number; height: number }, viewport: { width: number; height: number }): { left: number; top: number; placement: "above" | "below" } {
  const above = anchor.top - HINT_GAP - bubble.height;
  const below = anchor.bottom + HINT_GAP;
  const placement = above >= HINT_MARGIN || below + bubble.height > viewport.height - HINT_MARGIN ? "above" : "below";
  const top = placement === "above" ? Math.max(HINT_MARGIN, above) : below;
  const centred = anchor.left + anchor.width / 2 - bubble.width / 2;
  const left = Math.min(Math.max(HINT_MARGIN, centred), Math.max(HINT_MARGIN, viewport.width - HINT_MARGIN - bubble.width));
  return { left, top, placement };
}
