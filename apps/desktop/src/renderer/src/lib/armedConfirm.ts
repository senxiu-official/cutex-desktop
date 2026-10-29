// Click-twice confirmation for destructive actions inside a card (goal 清除, paused queue 清空):
// the first click "arms" — the button itself says what the second click does, in the danger colour,
// with a countdown bar along its bottom edge (seconds instead with reduced motion) — and it disarms by
// itself after ARMED_TIMEOUT_MS. Armed, Enter / Space confirm (the armed button has the focus) and Esc
// disarms. Disarmed by the timeout, a faint 「未开始：需要再点一次确认」 stays by the button for
// ARMED_EXPIRED_MS so nobody reads the reset as a failure (design 013). Low-frequency big operations
// (backend / app update, migrations, removing a host, deleting data) use confirmDialog instead.
import { useCallback, useEffect, useRef, useState } from "react";
import { translate } from "../i18n";
import { useOwnerWindow } from "./ownerContext";
import { isHTMLElement, windowOfDocument } from "./ownerWindow";

export const ARMED_TIMEOUT_MS = 5000;
/** How long the 「未开始」 note stays after an armed button disarmed by itself. */
export const ARMED_EXPIRED_MS = 4000;
/** Countdown along the armed element's bottom edge (styles.css `.armed-countdown`, ARMED_TIMEOUT_MS long). */
export const ARMED_COUNTDOWN = "armed-countdown";
/** Card frame while armed (border + tint); the card keeps its own size/padding classes. */
export const ARMED_FRAME = "border-danger/70 bg-danger/5";
/** The armed face alone (colours + countdown) for a button that keeps its own shape (components/ArmedButton). */
export const ARMED_FACE = `${ARMED_COUNTDOWN} bg-danger-solid text-white`;
/** The confirming button while armed. */
export const ARMED_BUTTON = `${ARMED_COUNTDOWN} rounded-md bg-danger-solid px-2 py-0.5 text-xs text-white`;
/** The confirming button where it replaces a settings `Button` (Form.tsx): same border and padding. */
export const ARMED_FORM_BUTTON = `${ARMED_COUNTDOWN} rounded-md border border-danger-solid bg-danger-solid px-3 py-1 text-xs text-white disabled:opacity-40`;

type Point = { x: number; y: number };

const centre = (r: DOMRect): Point => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/** The armed (countdown) element nearest to `near`: the button the first click turned into. */
export function nearestArmed(near: Point | null, root: ParentNode = document): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestDistance = Infinity;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(`.${ARMED_COUNTDOWN}`))) {
    const c = centre(el.getBoundingClientRect());
    const d = near ? Math.hypot(c.x - near.x, c.y - near.y) : 0;
    if (d < bestDistance) {
      best = el;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * `armed` resets after ARMED_TIMEOUT_MS (leaving the 「未开始」 note), on Esc, or immediately when
 * `resetKey` changes. Arming moves the focus to the armed button, so Enter / Space is the second click.
 */
export function useArmed(resetKey?: unknown): [boolean, (armed: boolean) => void] {
  const [armed, setArmedState] = useState(false);
  // The button's window (a desk window's, multi-window): its focus, keys, frames and the 「未开始」 note.
  const win = useOwnerWindow();
  // Where the first click happened (the armed button usually replaces the clicked one there).
  const origin = useRef<Point | null>(null);
  const setArmed = useCallback((next: boolean) => {
    if (next && typeof document !== "undefined") {
      const el = win.document.activeElement;
      origin.current = isHTMLElement(el) && el !== win.document.body ? centre(el.getBoundingClientRect()) : null;
    }
    setArmedState(next);
  }, [win]);
  useEffect(() => {
    if (!armed) return;
    let target: HTMLElement | null = null;
    const doc = win.document;
    const frame = win.requestAnimationFrame(() => {
      target = nearestArmed(origin.current, doc);
      if (target && doc.activeElement !== target && !(target as HTMLButtonElement).disabled) target.focus({ preventScroll: true });
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setArmedState(false);
    };
    win.addEventListener("keydown", onKey, true);
    const timer = setTimeout(() => {
      const el = target?.isConnected ? target : nearestArmed(origin.current, doc);
      if (el) showArmedExpired(el.getBoundingClientRect(), doc);
      setArmedState(false);
    }, ARMED_TIMEOUT_MS);
    return () => {
      win.cancelAnimationFrame(frame);
      win.removeEventListener("keydown", onKey, true);
      clearTimeout(timer);
    };
  }, [armed, win]);
  useEffect(() => setArmedState(false), [resetKey]);
  return [armed, setArmed];
}

let expiredNote: { el: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null;

/**
 * The faint 「未开始：需要再点一次确认」 next to where an armed button disarmed by itself (fixed, in
 * <body> of `doc` (the button's), never moves the layout); fades out after ARMED_EXPIRED_MS. One at a time.
 */
export function showArmedExpired(anchor: HintRect, doc: Document | undefined = typeof document === "undefined" ? undefined : document): void {
  if (!doc) return;
  hideArmedExpired();
  const view = windowOfDocument(doc);
  const el = doc.createElement("div");
  el.className = "armed-expired";
  el.setAttribute("role", "status");
  el.dataset.testid = "armed-expired";
  el.textContent = translate("armed.expired");
  doc.body.appendChild(el);
  const pos = armedHintPosition(anchor, { width: el.offsetWidth, height: el.offsetHeight }, { width: view.innerWidth, height: view.innerHeight });
  el.style.left = `${pos.left}px`;
  el.style.top = `${pos.top}px`;
  const timer = setTimeout(() => {
    el.classList.add("armed-expired-out");
    expiredNote = { el, timer: setTimeout(hideArmedExpired, 400) };
  }, ARMED_EXPIRED_MS);
  expiredNote = { el, timer };
}

export function hideArmedExpired(): void {
  if (!expiredNote) return;
  clearTimeout(expiredNote.timer);
  expiredNote.el.remove();
  expiredNote = null;
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
