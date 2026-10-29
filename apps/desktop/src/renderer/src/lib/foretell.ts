// 动作预告 foretell (docs/design/008-foretell.md, owner 2026-10-21): before a click changes the layout, hovering
// (or keyboard focus on) its control outlines the area it will affect with a dashed border and puts the
// result on it in one sentence — 「点击会替换 X（它会留在托盘里）」, not the action's name. Holding Ctrl/⌘
// switches the preview to the 并排 one. Colours are fixed by what happens to the screen:
//   replace (red)  — something leaves the screen (替换 / 关掉)
//   open    (blue) — focus / open here
//   beside  (green)— a new column beside
//   fold    (grey) — 收起 / 收进托盘 (it can come back)
// Shown after FORETELL_DELAY_MS (a pointer crossing it shows nothing); gone when the pointer leaves, the
// control is pressed or loses focus; it never changes anything. components/ForetellLayer draws it.
//
// The rule that keeps the preview honest: a control computes ONE effect object (`{ foretell, run }`, e.g.
// lib/workspaceEffects) and both the preview and the click come from it — the hover shows `effect.foretell`,
// the click calls `effect.run()`. Use `useForetell(() => effectFor(mods).foretell)` on the control and
// `effectFor(mods).run()` in its click handler.
// Shell code: names no feature. Pure parts tested in test/foretell.test.ts.
import { create } from "zustand";
import type { FocusEvent as ReactFocusEvent, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef } from "react";
import { foretellOn } from "./foretellPref";
import { useOwnerWindow } from "./ownerContext";
import { useInWindow } from "./windowScope";
import { isHTMLElement } from "./ownerWindow";

export type ForetellTone = "replace" | "open" | "beside" | "fold";

/** A box in window px. */
export interface ForetellBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** One outlined area: an element found by `selector` (the first one laid out) or a fixed box. */
export interface ForetellMark {
  selector?: string;
  /** Only this half of the `selector` element (where a column beside will appear), measured in the window that draws it. */
  half?: "left" | "right";
  box?: ForetellBox;
  /** This area's own sentence (else the foretell's `text` on the first mark). */
  text?: string;
  /** This area's tone (else the foretell's). */
  tone?: ForetellTone;
}

export interface Foretell {
  /**
   * Not a click's preview (the Settings Shelf's 「影响这里」 outline of a setting's panel, lib/settingsAffects): shown
   * whatever the 动作预告 switch says.
   */
  always?: boolean;
  tone: ForetellTone;
  /** The result, said on the (first) outlined area. */
  text: string;
  marks: ForetellMark[];
}

/** Modifier state a preview depends on (Ctrl/⌘ held = 并排). */
export interface ForetellMods {
  beside: boolean;
}

/** The pointer rests this long before the preview shows (a pointer crossing the control shows nothing). */
export const FORETELL_DELAY_MS = 150;

interface ForetellState {
  shown: Foretell | null;
  /** Who shows it (a later hide from another control does not remove it). */
  owner: object | null;
  /** The document of the control that shows it (a desk window's, multi-window): the outlines are drawn there. Null: the main window. */
  doc?: Document | null;
}

export const useForetellStore = create<ForetellState>(() => ({ shown: null, owner: null }));

/** Shows `f` for `owner` (null: hides what `owner` shows); `doc`: the control's document (default: the main window's). */
export function setForetell(owner: object, f: Foretell | null, doc: Document | null = null): void {
  const s = useForetellStore.getState();
  if (!f) {
    if (s.owner === owner) useForetellStore.setState({ shown: null, owner: null });
    return;
  }
  // 动作预告 switched off (lib/foretellPref): no click previews; what this owner showed goes.
  if (!f.always && !foretellOn()) {
    if (s.owner === owner) useForetellStore.setState({ shown: null, owner: null });
    return;
  }
  if (s.owner === owner && sameForetell(s.shown, f) && (s.doc ?? null) === doc) return;
  useForetellStore.setState({ shown: f, owner, doc: doc ?? undefined });
}

/** Hides any preview (a layout change, Esc, a drag starting). */
export function clearForetell(): void {
  if (useForetellStore.getState().shown) useForetellStore.setState({ shown: null, owner: null });
}

export function sameForetell(a: Foretell | null, b: Foretell | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.tone !== b.tone || a.text !== b.text || a.marks.length !== b.marks.length) return false;
  return a.marks.every((m, i) => {
    const n = b.marks[i]!;
    return m.selector === n.selector && m.half === n.half && m.text === n.text && m.tone === n.tone && JSON.stringify(m.box) === JSON.stringify(n.box);
  });
}

/** The gap left between the two halves of a row (`ForetellMark.half`). */
const HALF_GAP = 4;

/** The left / right half of `r` (a column beside will appear there), HALF_GAP apart. */
export function halfBox(r: ForetellBox, side: "left" | "right"): ForetellBox {
  const width = r.width / 2 - HALF_GAP;
  return { left: side === "left" ? r.left : r.left + r.width / 2 + HALF_GAP, top: r.top, width, height: r.height };
}

/**
 * `box` cut to the window's viewport (`view`: its inner size): an outline — and the sentence centred on it — never
 * runs past the window's edge. Null when nothing of it is inside.
 */
export function boxInView(box: ForetellBox, view: { width: number; height: number }): ForetellBox | null {
  const left = Math.max(box.left, 0);
  const top = Math.max(box.top, 0);
  const width = Math.min(box.left + box.width, view.width) - left;
  const height = Math.min(box.top + box.height, view.height) - top;
  return width > 0 && height > 0 ? { left, top, width, height } : null;
}

/** Ctrl / ⌘ held (the platform's "new instance" modifier: either works, like the clicks). */
export const besideHeld = (e: Pick<KeyboardEvent | MouseEvent, "ctrlKey" | "metaKey">): boolean => e.ctrlKey || e.metaKey;

/** The sentence's tone of a mark (its own, else the foretell's). */
export const markTone = (f: Foretell, m: ForetellMark): ForetellTone => m.tone ?? f.tone;

/** The sentence a mark carries: its own, else the foretell's on the first mark only. */
export const markText = (f: Foretell, index: number): string | null => f.marks[index]?.text ?? (index === 0 ? f.text : null);

export interface ForetellHandlers {
  onPointerEnter(e: ReactPointerEvent): void;
  onPointerLeave(): void;
  onPointerDown(): void;
  onFocus(e: ReactFocusEvent): void;
  onBlur(): void;
}

/**
 * The hover / focus preview of a control: after FORETELL_DELAY_MS it shows `compute(mods)`; Ctrl/⌘ pressed or
 * released while shown recomputes it; leaving, blurring or pressing the control hides it. `compute` is read
 * when shown (keep it cheap; it may return null: nothing to foretell). Spread the handlers on the control
 * (call yours too when it has its own).
 */
export function useForetell(compute: (mods: ForetellMods) => Foretell | null, opts: { disabled?: boolean } = {}): ForetellHandlers {
  const owner = useRef<object>({}).current;
  const win = useOwnerWindow();
  const doc = win.document === document ? null : win.document;
  const fn = useRef(compute);
  fn.current = compute;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(false);
  const mods = useRef<ForetellMods>({ beside: false });
  const disabled = !!opts.disabled;

  // Computed in this control's window (multi-window P3): a hover in a desk previews that desk's layout.
  const inMine = useInWindow();
  const show = () => {
    active.current = true;
    setForetell(owner, inMine(() => fn.current(mods.current)), doc);
  };
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    active.current = false;
    setForetell(owner, null);
  };
  const start = (beside: boolean) => {
    if (disabled) return;
    mods.current = { beside };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      show();
    }, FORETELL_DELAY_MS);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Control" && e.key !== "Meta") return;
      const beside = e.type === "keydown" ? true : besideHeld(e);
      if (beside === mods.current.beside) return;
      mods.current = { beside };
      if (active.current) show();
    };
    win.addEventListener("keydown", onKey, true);
    win.addEventListener("keyup", onKey, true);
    return () => {
      win.removeEventListener("keydown", onKey, true);
      win.removeEventListener("keyup", onKey, true);
      stop();
    };
  }, [win]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (disabled) stop();
  }, [disabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    onPointerEnter: (e) => start(besideHeld(e)),
    onPointerLeave: stop,
    onPointerDown: stop,
    onFocus: (e) => {
      // Only keyboard focus previews (a click focuses too, and the click itself acts).
      if (isHTMLElement(e.currentTarget) && !e.currentTarget.matches(":focus-visible")) return;
      start(false);
    },
    onBlur: stop,
  };
}

/**
 * A preview driven from outside a hover (⌘K's selected row): shows `f` for `owner` after the delay, replacing
 * what `owner` showed; null hides it at once. Returns the cancel of the pending show.
 */
export function foretellAfterDelay(owner: object, f: Foretell | null, doc: Document | null = null): () => void {
  if (!f) {
    setForetell(owner, null);
    return () => {};
  }
  const t = setTimeout(() => setForetell(owner, f, doc), FORETELL_DELAY_MS);
  return () => clearTimeout(t);
}

/** Merges handler sets (the control's own first). */
export function withHandlers<T extends Partial<Record<keyof ForetellHandlers, (...a: never[]) => void>>>(own: T, f: ForetellHandlers): T & ForetellHandlers {
  const out: Record<string, unknown> = { ...f };
  for (const [k, v] of Object.entries(own)) {
    const g = (f as unknown as Record<string, ((...a: unknown[]) => void) | undefined>)[k];
    out[k] =
      typeof v === "function" && g
        ? (...a: unknown[]) => {
            (v as (...a: unknown[]) => void)(...a);
            g(...a);
          }
        : v;
  }
  return out as unknown as T & ForetellHandlers;
}
