// Short pane (owner 2026-10-26, option B of .claude/previews/short-pane-options): the history never gets squeezed
// below max(120 px, 30 % of the conversation pane) by 「接下来」. Where the panel would push it below that, the panel
// folds to its one-line header and its list opens as an overlay above that line (over the history, absolutely
// positioned, so opening it changes no layout). The fold is a 「接下来」 shrink, so the history-only-moves-up rule
// (lib/stickToBottom nextSlack) turns it into blank room under the rows instead of moving them down.
//
// Measured in Conversation's resize observer (the one that follows the bottom), before the follow / keepRowsUp, so the
// fold and the blank land in the same frame; QueuePanel reads the result from ShortPaneContext.
//
// Precedence (QueuePanel): the owner's own choice wins over the auto-fold —
//   * a panel the owner collapsed (chevron, remembered per agent) or that started compact stays that way; the rule
//     never unfolds what it did not fold;
//   * expanding it by hand while the pane is short keeps it expanded in place ("pinned") until the pane has room for
//     it again (the rule no longer folds), the owner collapses it, or the agent changes; then the rule applies again;
//   * the rule only folds a panel the owner left expanded, and unfolds only that.
import { createContext, useContext, useSyncExternalStore } from "react";

/** The history's floor: 120 px, or 30 % of the pane when that is more. */
export const HISTORY_MIN_PX = 120;
export const HISTORY_MIN_SHARE = 0.3;
/** Folded, the panel unfolds only once the history would keep this much more than its minimum (no flapping on a line). */
export const UNFOLD_MARGIN_PX = 32;
/** The overlay never covers the history's top this close (px). */
export const OVERLAY_GAP_PX = 12;
/** …and is at least this tall, even in a tiny pane. */
export const OVERLAY_MIN_PX = 80;

/** The history's minimum height in a pane `pane` px tall. */
export function historyMin(pane: number): number {
  return Math.max(HISTORY_MIN_PX, Math.round(pane * HISTORY_MIN_SHARE));
}

export interface ShortPaneMeasure {
  /** The conversation pane (main) height. */
  pane: number;
  /** The history's viewport now (the timeline scroller). */
  history: number;
  /** 「接下来」 as laid out now (0 = none). */
  tray: number;
  /** 「接下来」 with its list in place (not folded); equal to `tray` while it is in place. */
  trayUnfolded: number;
  /** It has a list to fold (false: none, or collapsed by the owner / compact — only its header line shows). */
  list: boolean;
  /** It is folded by this rule now. */
  folded: boolean;
}

/** The history's height with 「接下来」 unfolded — the same whether the panel is folded now or not. */
export function historyUnfolded(m: ShortPaneMeasure): number {
  return m.history + m.tray - m.trayUnfolded;
}

/**
 * Whether 「接下来」 is (to be) folded. Folds when unfolded it would leave the history under its minimum; once folded it
 * unfolds only when the history would keep UNFOLD_MARGIN_PX more than that. A panel with nothing to fold (no list:
 * collapsed by the owner, compact, none at all) is never folded by the rule. A list kept in place by the owner
 * (pinned) still counts: the result then says whether the pane is short, which is what ends the pin.
 */
export function shortPaneFold(m: ShortPaneMeasure): boolean {
  if (!m.list) return false;
  const min = historyMin(m.pane);
  const unfolded = historyUnfolded(m);
  return m.folded ? unfolded < min + UNFOLD_MARGIN_PX : unfolded < min;
}

/** The overlay's max height: the history above the header line, less a gap (at least OVERLAY_MIN_PX). */
export function overlayMax(history: number): number {
  return Math.max(OVERLAY_MIN_PX, Math.round(history - OVERLAY_GAP_PX));
}

// The composer's input (owner 2026-10-27): a long draft no longer squeezes the history to nothing. The input grows with
// its text only while the history keeps its minimum; beyond that it scrolls inside itself. It always keeps
// INPUT_MIN_LINES lines (in a pane too short for both, the history gives way), and never grows past its own max-h-60
// (15rem) — the CSS takes min(15rem, this cap), so a tall pane looks exactly as before. Measured in the same pass as
// the fold, after it: a fold first gives the history room, which the input may then take. Sending shrinks the input by
// at most cap − its empty height, so the rows have little to move, and the history-only-moves-up rule covers that.

/** The input keeps at least this many lines (plus its padding), even where that leaves the history under its minimum. */
export const INPUT_MIN_LINES = 3;

export interface ComposerInputMeasure {
  /** The input's height now (border box). */
  input: number;
  /** Its INPUT_MIN_LINES height (border box). */
  floor: number;
}

/**
 * The input's max height: what it has now plus what the history has above its minimum — so growing up to it leaves
 * the history exactly at its minimum (the sum is what the layout gives both) — and at least `floor`.
 */
export function composerInputMax(pane: number, history: number, c: ComposerInputMeasure): number {
  return Math.max(c.floor, Math.floor(c.input + history - historyMin(pane)));
}

/** The pane's composer input (null: none shown, e.g. archived or an interaction waiting). */
export function measureComposerInput(main: HTMLElement): ComposerInputMeasure | null {
  const el = main.querySelector<HTMLElement>("[data-composer-block] [data-composer-input]");
  if (!el || el.offsetParent === null) return null;
  const s = getComputedStyle(el);
  const px = (v: string) => parseFloat(v) || 0;
  // "normal" in a test DOM: about 1.5 × the font size.
  const line = px(s.lineHeight) || px(s.fontSize) * 1.5 || 21;
  const floor = Math.ceil(INPUT_MIN_LINES * line + px(s.paddingTop) + px(s.paddingBottom) + px(s.borderTopWidth) + px(s.borderBottomWidth));
  return { input: el.offsetHeight, floor };
}

/** The DOM reads for one pane: `main` the conversation pane, `scroller` the history's viewport. */
export function measureShortPane(main: HTMLElement, scroller: HTMLElement): ShortPaneMeasure | null {
  const pane = main.clientHeight;
  if (!pane) return null;
  const history = scroller.clientHeight;
  const tray = main.querySelector<HTMLElement>("[data-queue-tray]");
  if (!tray || tray.offsetParent === null) return { pane, history, tray: 0, trayUnfolded: 0, list: false, folded: false };
  const shown = tray.offsetHeight;
  const folded = tray.hasAttribute("data-short-fold");
  const body = tray.querySelector<HTMLElement>("[data-queue-body]");
  // Folded, the list is the overlay (out of flow): unfolded it would add its rows (scrollHeight) without the overlay's
  // own padding.
  let trayUnfolded = shown;
  if (body && folded) {
    const s = getComputedStyle(body);
    trayUnfolded += body.scrollHeight - (parseFloat(s.paddingTop) || 0) - (parseFloat(s.paddingBottom) || 0);
  }
  return { pane, history, tray: shown, trayUnfolded, list: !!body, folded };
}

/** One conversation pane's fold state: written by Conversation's observer, read by its QueuePanel. */
export interface ShortPaneStore {
  get(): boolean;
  set(fold: boolean): void;
  subscribe(fn: () => void): () => void;
  /** Ask the pane to measure again (the folded list changed: no layout change for the observer to see). */
  recheck(): void;
  /** Set by Conversation: measure and apply. */
  onRecheck: (() => void) | null;
}

export function createShortPaneStore(): ShortPaneStore {
  let fold = false;
  const subs = new Set<() => void>();
  return {
    get: () => fold,
    set(v) {
      if (v === fold) return;
      fold = v;
      for (const fn of [...subs]) fn();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    recheck() {
      this.onRecheck?.();
    },
    onRecheck: null,
  };
}

export const ShortPaneContext = createContext<ShortPaneStore | null>(null);

const NO_SUB = () => () => {};
const NO_FOLD = () => false;

/** The pane's fold (false outside a conversation pane, e.g. the side agent). */
export function useShortPaneFold(): { fold: boolean; store: ShortPaneStore | null } {
  const store = useContext(ShortPaneContext);
  const fold = useSyncExternalStore(store ? store.subscribe : NO_SUB, store ? store.get : NO_FOLD, NO_FOLD);
  return { fold, store };
}
