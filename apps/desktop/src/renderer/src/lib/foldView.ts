// Long-message folding, React side: per-message manual fold state (in memory, per agent; cleared
// when the conversation switches agents) and `useMessageFold`, which measures a message's visual
// lines and keeps the reading position when a fold toggles. Rules: lib/messageFold.
import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { autoFolds, foldView, lineHeightPx, visualLines, type FoldManual, type FoldRole, type FoldView } from "./messageFold";
import { useUiPrefs } from "./prefs";

let manual: Record<string, Record<string, FoldManual>> = {};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

export function setFold(sessionId: string, id: string, value: FoldManual | undefined): void {
  const forSession = { ...manual[sessionId] };
  if (value) forSession[id] = value;
  else delete forSession[id];
  manual = { ...manual, [sessionId]: forSession };
  emit();
}

/** Back to the settings' defaults (the conversation switched agents). */
export function resetFolds(): void {
  if (Object.keys(manual).length === 0) return;
  manual = {};
  emit();
}

/** Unfold a message (for search / jump-to landing inside a folded part). */
export function revealMessage(sessionId: string, id: string): void {
  setFold(sessionId, id, "open");
}

/** Nearest scrolling ancestor of `el`. */
export function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY;
    if (overflow === "auto" || overflow === "scroll") return p;
  }
  return null;
}

export interface MessageFold extends FoldView {
  /** Measured visual lines (0 before the first measurement / when folding is off). */
  lines: number;
  /** On the element whose height is the message's full content (inside the clip). */
  contentRef: (el: HTMLElement | null) => void;
  /** On the element that frames the message (its top is kept in view across toggles). */
  frameRef: (el: HTMLElement | null) => void;
  /** Fold (true) / unfold (false) by hand. */
  setFolded(folded: boolean): void;
  enabled: boolean;
}

/**
 * Fold state of one message. `role` "off" (streaming text, other rows) skips measuring entirely,
 * so a streaming reply costs nothing per token.
 */
export function useMessageFold(sessionId: string, id: string, role: FoldRole): MessageFold {
  const prefs = useUiPrefs();
  const enabled = role !== "off";
  const mine = useSyncExternalStore(subscribe, () => manual[sessionId]?.[id]);
  const [lines, setLines] = useState(0);
  const content = useRef<HTMLElement | null>(null);
  const frame = useRef<HTMLElement | null>(null);
  const [node, setNode] = useState<HTMLElement | null>(null);
  const contentRef = useCallback((el: HTMLElement | null) => {
    content.current = el;
    setNode(el);
  }, []);
  const frameRef = useCallback((el: HTMLElement | null) => void (frame.current = el), []);

  // Measure before paint (the overlay shows in the first frame), then on size changes. The clip
  // itself never depends on this, so heights are final at first layout.
  useLayoutEffect(() => {
    if (!enabled || !node) return;
    const measure = () => {
      const style = getComputedStyle(node);
      setLines(visualLines(node.getBoundingClientRect().height, lineHeightPx(style.lineHeight, style.fontSize)));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [enabled, node]);

  // A toggle keeps the message's top where it was on screen; a fold whose top had scrolled off
  // brings the top back into view. Then a synthetic scroll lets the conversation re-read whether
  // it is still at the bottom (so stick-to-bottom does not yank the view away).
  const anchor = useRef<{ top: number; folding: boolean } | null>(null);
  const setFolded = useCallback(
    (folded: boolean) => {
      const el = frame.current;
      anchor.current = el ? { top: el.getBoundingClientRect().top, folding: folded } : null;
      setFold(sessionId, id, folded ? "folded" : "open");
    },
    [sessionId, id],
  );
  useLayoutEffect(() => {
    const a = anchor.current;
    const el = frame.current;
    anchor.current = null;
    if (!a || !el) return;
    const scroller = scrollParent(el);
    if (!scroller) return;
    const viewTop = scroller.getBoundingClientRect().top;
    const want = a.folding && a.top < viewTop ? viewTop + 8 : a.top;
    const delta = el.getBoundingClientRect().top - want;
    if (Math.abs(delta) > 0.5) scroller.scrollTop += delta;
    scroller.dispatchEvent(new Event("scroll"));
  }, [mine]);

  const view = enabled ? foldView(autoFolds(role, prefs), mine, lines, prefs.foldLines) : { clipLines: null, overflowing: false, collapsible: false, canFold: false };
  return { ...view, lines: enabled ? lines : 0, contentRef, frameRef, setFolded, enabled };
}
