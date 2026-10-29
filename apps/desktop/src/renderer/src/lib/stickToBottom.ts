// Stick-to-bottom for the conversation timeline (components/Conversation.tsx): the pure rules, the
// composer's "I just sent" signal and the watch for the owner's own scrolling input.
import { INTENT_WINDOW, scrollKey } from "./overlayScrollbars";
import { isHTMLElement } from "./ownerWindow";

/** Bottom zone where scrolling back down resumes following. */
export const STICK_THRESHOLD = 48;

export interface ScrollSample {
  top: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * What one scroll event means for following the bottom. `prev`: the scroller at the previous scroll
 * event (null before the first one).
 *
 * Only the owner scrolling UP lets go. A scroll that did not move up while following — the browser's
 * own adjustment (scroll anchoring, clamping) in the frame where new rows landed, before the
 * ResizeObserver could snap, or the viewport changing size — keeps following and snaps back to the
 * bottom (`snap`). Without this, a fresh user bubble (taller than the threshold on its own) made such
 * a scroll read as "scrolled away", and the timeline stopped following right after a send.
 *
 * `user`: the owner's own input (wheel, touch, scroll keys, a drag) could have caused this scroll
 * (watchScrollIntent). Without it a scroll never lets go, even one that moved UP: the browser moves
 * the position up by itself too — scroll anchoring when the oldest shown turn leaves the top of the
 * 长对话 window as a new turn starts, clamping when content above or the viewport changes — and when
 * that scroll event is handled before the ResizeObserver snapped to the grown bottom (the new turn's
 * header and live line), it looked exactly like the owner scrolling up: the reply then streamed
 * below the view (owner, 2026-10-23).
 */
export function scrollFollow(stick: boolean, prev: { top: number; clientHeight: number } | null, now: ScrollSample, user = true): { stick: boolean; snap: boolean } {
  const gap = now.scrollHeight - now.top - now.clientHeight;
  // The first small upward wheel step must release even inside the bottom threshold.
  // Otherwise streamed text / late row layout snaps it back before the next step.
  const moved = prev ? now.top - prev.top : 0;
  if (user && prev && now.clientHeight === prev.clientHeight && moved < -1) return { stick: false, snap: false };
  // Once released, layout/clamping (or another event at the same position) cannot
  // reattach it. The owner must scroll down into the bottom zone.
  if (gap < STICK_THRESHOLD) return { stick: stick || (user && (!prev || moved > 1)), snap: false };
  if (stick && (!user || !prev || now.clientHeight !== prev.clientHeight || now.top >= prev.top - 1)) return { stick: true, snap: true };
  return { stick: false, snap: false };
}

/** The overlay scrollbars' layer (lib/overlayScrollbarManager): a wheel over a thumb, a dragged thumb. */
const OVERLAY_LAYER = "[data-overlay-scrollbars]";

export interface ScrollIntentWatch {
  /** Whether a scroll of the scroller now may be the owner's own: within INTENT_WINDOW ms of a wheel /
   *  touch over it, a scroll key aimed at it, a press in it; or while a press in it / a thumb drag lasts. */
  user(): boolean;
  /** Forget the input so far (the owner sent: back to the bottom, whatever the wheel did before). */
  reset(): void;
  dispose(): void;
}

function isNode(t: EventTarget | null): t is Node {
  return !!t && typeof (t as Node).nodeType === "number";
}

function editable(t: EventTarget | null): boolean {
  if (!isNode(t) || t.nodeType !== 1) return false;
  const el = t as HTMLElement;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

/**
 * Watches the input that can scroll `scroller` (window listeners, capture, passive). Only such input
 * lets stick-to-bottom go (scrollFollow's `user`); the layout moving the position never does.
 * `onWheelUp` releases before an upward wheel can end a smooth jump and run its completion snap.
 */
export function watchScrollIntent(scroller: HTMLElement, clock: () => number = () => performance.now(), onWheelUp?: () => void): ScrollIntentWatch {
  const doc = scroller.ownerDocument;
  const win = doc.defaultView;
  let at = Number.NEGATIVE_INFINITY;
  let held = false;
  const over = (t: EventTarget | null) => {
    if (!isNode(t)) return false;
    if (scroller.contains(t)) return true;
    const el = t.nodeType === 1 ? (t as Element) : t.parentElement;
    return !!el?.closest(OVERLAY_LAYER);
  };
  const onWheel = (e: Event) => {
    if (!over(e.target)) return;
    at = clock();
    // A wheel cancels a native smooth jump with scrollend before its scroll event.
    // Release first so the jump's completion callback cannot snap back down.
    const wheel = e as WheelEvent;
    if (e.type === "wheel" && wheel.deltaY < 0 && !wheel.ctrlKey && !wheel.shiftKey && isNode(e.target) && scroller.contains(e.target)) onWheelUp?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (!scrollKey(e.key) || editable(e.target)) return;
    // The key scrolls the focused scroller, or the page's last clicked one when nothing has the focus.
    const focus = doc.activeElement;
    if (!focus || focus === doc.body || focus === doc.documentElement || scroller.contains(focus)) at = clock();
  };
  const onDown = (e: Event) => {
    if (!over(e.target)) return;
    held = true;
    at = clock();
  };
  const onUp = () => {
    if (!held) return;
    held = false;
    at = clock();
  };
  const capture = { capture: true, passive: true } as const;
  const listen = [
    ["wheel", onWheel],
    ["touchstart", onWheel],
    ["touchmove", onWheel],
    ["keydown", onKey],
    ["pointerdown", onDown],
    ["pointerup", onUp],
    ["pointercancel", onUp],
  ] as const;
  for (const [type, fn] of listen) win?.addEventListener(type, fn as EventListener, capture);
  return {
    user() {
      if (held || doc.querySelector(`${OVERLAY_LAYER} [data-dragging]`)) return true;
      const now = clock();
      return now >= at && now - at <= INTENT_WINDOW;
    },
    reset() {
      at = Number.NEGATIVE_INFINITY;
    },
    dispose() {
      for (const [type, fn] of listen) win?.removeEventListener(type, fn as EventListener, capture);
    },
  };
}

/** The timeline's shape that moves its bottom without adding an entry (a turn starting / ending: its
 *  header and live line come and go, and the oldest shown turn may leave the top of the 长对话 window). */
export function turnFollowKey(timeline: { turns: readonly unknown[]; activeTurnId?: string | null } | undefined): string {
  return timeline ? `${timeline.turns.length}:${timeline.activeTurnId ?? ""}` : "";
}

type FollowListener = (sessionId: string) => void;
const listeners = new Set<FollowListener>();

/** The owner sent from the composer: the agent's timeline goes (back) to the bottom and follows. */
export function followAfterSend(sessionId: string): void {
  for (const fn of [...listeners]) fn(sessionId);
}

/** The conversation listens for sends; returns the unsubscribe. */
export function onFollowAfterSend(fn: FollowListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * The pending sends that sit in (or move into) the timeline, as a string for a zustand selector:
 * when it changes, the conversation follows in its layout effect like it does for new entries — the
 * optimistic bubble is outbox state, not a timeline entry.
 */
export function pendingFollowKey(list: readonly { id: string; placement: string; state?: string }[] | undefined): string {
  return (list ?? []).map((e) => `${e.id}:${e.placement}:${e.state ?? ""}`).join("\n");
}

/**
 * History only moves up (owner 2026-10-26; 「接下来」 included 2026-10-27): the blank room under the rows
 * (Conversation's slack spacer) after one layout change while following the bottom. `moved`: how far the rows on
 * screen went down with the room as it was — the one that went down the most (negative: they all went up, at least
 * that far). What would pull the rows down — the live line leaving at a turn's end, the 需要你 strip or a status row
 * going away, the input box or 「接下来」 getting shorter (a draft sent; a queued message taken, deleted or edited
 * shorter; the panel folded or emptied), a row getting shorter — becomes room under them instead; anything that would
 * move them up (new rows, a taller row, a taller panel) fills that room first, so a panel that shrinks and grows back
 * leaves no room behind.
 */
export function nextSlack(slack: number, moved: number): number {
  if (moved > 0.5) return slack + moved;
  if (moved < -0.5) return Math.max(0, slack + moved);
  return slack;
}

/**
 * The room after the conversation pane itself changed size (the window resized, a Shelf / split divider dragged):
 * a resize by the owner is not jitter. `grew`: how much taller the pane got (negative: shorter). Taller: the rows stay
 * anchored to the bottom as before the only-up rule, and the room under them shrinks by the growth (never below 0) —
 * counting the rows going down with the taller viewport as room left a big blank under them (440 px at 1440x960 after
 * growing from a short window). Only width changed: the room stays. Shorter is not handled here (keepRowsUp: the rows
 * going up with the shorter viewport eat the room first, as for any change inside the pane).
 */
export function resizedSlack(slack: number, grew: number): number {
  return grew > 0.5 ? Math.max(0, slack - grew) : slack;
}

/** keepRowsUp's reference: the rows on screen and their tops; the pane's outer size (`main`), null without one. */
export interface RowsAnchor {
  rows: [HTMLElement, number][];
  pane: { width: number; height: number } | null;
}

/** The timeline rows from the bottom up to the first one on screen (`top`: the scroller's top edge), with their tops. */
function rowsOnScreen(col: HTMLElement, top: number): [HTMLElement, number][] {
  const out: [HTMLElement, number][] = [];
  for (let el = col.lastElementChild; el && out.length < 60; el = el.previousElementSibling) {
    if (!isHTMLElement(el) || !el.hasAttribute("data-tl-row")) continue;
    const r = el.getBoundingClientRect();
    if (!r.height) continue;
    out.push([el, r.top]);
    if (r.top <= top) break;
  }
  return out;
}

/** The anchor for the layout as it is now (scroller `el`, timeline column `col`). */
export function anchorRows(el: HTMLElement, col: HTMLElement): RowsAnchor {
  const main = el.closest("main")?.getBoundingClientRect();
  return { rows: rowsOnScreen(col, el.getBoundingClientRect().top), pane: main ? { width: main.width, height: main.height } : null };
}

/**
 * History only moves up, after one layout change while following the bottom (Conversation's ResizeObserver, already
 * snapped to the bottom): sets the room under the rows (`setRoom`, then snaps again) from how the rows on screen moved
 * since `prev` (nextSlack) — or, when the pane's own outer size changed and it did not get shorter, from the resize
 * (resizedSlack). `userToggle`: instead reset all room and re-anchor at the normal bottom. Returns the new anchor.
 */
export function keepRowsUp(el: HTMLElement, col: HTMLElement, prev: RowsAnchor | null, slack: number, setRoom: (px: number) => void, userToggle = false): RowsAnchor {
  // A manual expand / collapse opts out of the only-up rule: no old room, no room from this shrink,
  // and a fresh reference so the next automatic change is measured independently.
  if (userToggle) {
    setRoom(0);
    el.scrollTo({ top: el.scrollHeight });
    return anchorRows(el, col);
  }
  const now = anchorRows(el, col);
  let next = slack;
  const was = prev?.pane, pane = now.pane;
  const grew = was && pane ? pane.height - was.height : 0;
  if (was && pane && grew > -0.5 && (grew > 0.5 || Math.abs(pane.width - was.width) > 0.5)) next = resizedSlack(slack, grew);
  else if (prev) {
    // The row that went down the most (or up the least) since the last change.
    let moved = Number.NEGATIVE_INFINITY;
    for (const [row, top] of prev.rows) if (row.parentElement === col) moved = Math.max(moved, row.getBoundingClientRect().top - top);
    if (moved > Number.NEGATIVE_INFINITY) next = nextSlack(slack, moved);
  }
  if (next === slack) return now;
  setRoom(next);
  el.scrollTo({ top: el.scrollHeight });
  return anchorRows(el, col);
}
