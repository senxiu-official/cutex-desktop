// History pages land above what the owner is reading (lib/historyPages prependHistory): the scroller's
// content grows at the top. At scrollTop 0 the browser does not anchor the view, so without help the
// page stays at the very top and shows the thread's first turns — the turns the owner scrolled
// through are suddenly far below. Note the distance from the bottom before the commit and restore it
// after (the main conversation does the same inline, components/Conversation.tsx).
import { useLayoutEffect, useRef, type RefObject } from "react";

export interface ShownStart {
  /** The view (session) the scroller shows. */
  key: string | null;
  /** Its timeline's first loaded turn. */
  turn: string | null;
}

/** True when the same view's first loaded turn changed: turns were added (or replaced) above. */
export function startMoved(prev: ShownStart, next: ShownStart): boolean {
  return prev.key === next.key && prev.turn !== null && next.turn !== null && prev.turn !== next.turn;
}

/**
 * Keep the reading position of `scroller` when turns are prepended to the view `key` (first loaded
 * turn `firstTurn`). Nothing while `stuck` (the view follows the bottom: its own effect scrolls).
 * Call it during render, before the commit that adds the turns.
 */
export function useKeepOnPrepend(scroller: RefObject<HTMLElement | null>, key: string | null, firstTurn: string | null, stuck: RefObject<boolean>): void {
  const shown = useRef<ShownStart>({ key: null, turn: null });
  const fromBottom = useRef<number | null>(null);
  const next = { key, turn: firstTurn };
  const el = scroller.current;
  if (el && !stuck.current && startMoved(shown.current, next)) fromBottom.current = el.scrollHeight - el.scrollTop;
  shown.current = next;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || fromBottom.current === null) return;
    el.scrollTop = el.scrollHeight - fromBottom.current;
    fromBottom.current = null;
  });
}
