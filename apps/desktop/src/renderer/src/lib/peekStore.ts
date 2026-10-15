// The reference card (docs/desktop-modules.md §19.4): one `peekable` component instance shown in the
// left gutter (or floating over the column with 总在左侧), outside the right side's layout. One at a
// time — the next replaces it; memory only (gone after a restart); not modal. Closed by ×, Esc (the
// chain, lib/escChain.ts), 跳过去, 在右侧打开 and on a view-scope (host) change; kept on agent switch
// (its header names whose it is). Focus goes back to where it was before the card opened.
import { create } from "zustand";
import type { SideBinding } from "../modules/slots";
import type { ItemId, Json } from "../modules/types";
import { useGutter } from "./gutterStore";
import { peekTarget, type PeekSetting, type PeekWhere } from "./peekTarget";

export interface PeekInstance {
  /** "peek:<n>" — never a right-side instance id. */
  id: string;
  kind: ItemId;
  binding: SideBinding;
  key: string | null;
  /** The open params (在右侧打开 reopens with them, then carries the state over). */
  params: Json;
  state: Json;
  v: number;
  /** The view scope's host when it opened: a scope change closes it. */
  hostId: string;
  where: "gutter" | "overlay";
  /** An explicit per-open target (refs.open how:"peek" forces left). Absent = follow the live UI setting. */
  preference?: PeekSetting;
}

/** Re-evaluate geometry without discarding the opening action's explicit placement. */
export function currentPeekTarget(peek: Pick<PeekInstance, "preference"> | null, setting: PeekSetting, gutterWidth: number, peekMin: number, conversationVisible: boolean): PeekWhere {
  return peekTarget(peek?.preference ?? setting, gutterWidth, peekMin, conversationVisible);
}

export interface PeekStoreState {
  peek: PeekInstance | null;
  /** SideBodyProps.revealed of the card. */
  revealed: number;
  /** Bumped when the same reference is opened again: the card flashes instead of reopening. */
  flash: number;
}

export const usePeek = create<PeekStoreState>(() => ({ peek: null, revealed: 0, flash: 0 }));

let seq = 0;
let returnFocus: HTMLElement | null = null;

export function peekOpen(): boolean {
  return usePeek.getState().peek !== null;
}

/** Shows `next` (replacing any card); the same kind + key again only flashes and updates it. */
export function showPeek(next: Omit<PeekInstance, "id">, focus: boolean): { id: string; reused: boolean } {
  const s = usePeek.getState();
  const same = !!s.peek && s.peek.kind === next.kind && next.key !== null && s.peek.key === next.key && s.peek.hostId === next.hostId;
  if (!s.peek) {
    const active = document.activeElement;
    // Opened from a gutter list (which closes now): focus goes back to its trigger.
    const fromList = active instanceof HTMLElement && !!active.closest("[data-gutter-popover]");
    returnFocus = fromList ? useGutter.getState().lastTrigger : active instanceof HTMLElement && active !== document.body ? active : null;
  }
  const id = same ? s.peek!.id : `peek:${++seq}`;
  usePeek.setState({ peek: { ...next, id }, flash: same ? s.flash + 1 : s.flash, revealed: focus ? s.revealed + 1 : s.revealed });
  return { id, reused: same };
}

export function setPeekState(id: string, state: Json, v: number): void {
  const peek = usePeek.getState().peek;
  if (peek?.id === id) usePeek.setState({ peek: { ...peek, state, v } });
}

export function setPeekWhere(where: PeekInstance["where"]): void {
  const peek = usePeek.getState().peek;
  if (peek && peek.where !== where) usePeek.setState({ peek: { ...peek, where } });
}

/**
 * Closes the card. Focus goes back to where it was before it opened when it is still there and focus
 * was inside the card (or nowhere); else `fallback` (the gutter trigger that opened it) / the composer.
 * `focus: false` (在右侧打开: the new right-side card takes focus) leaves focus alone.
 */
export function closePeek(opts: { focus?: boolean; fallback?: () => HTMLElement | null } = {}): void {
  const s = usePeek.getState();
  if (!s.peek) return;
  const card = document.querySelector("[data-peek-card]");
  const active = document.activeElement;
  const focusWasInside = !active || active === document.body || (!!card && card.contains(active));
  usePeek.setState({ peek: null });
  const target = returnFocus?.isConnected ? returnFocus : (opts.fallback?.() ?? null);
  returnFocus = null;
  if (opts.focus !== false && focusWasInside) (target ?? document.querySelector<HTMLElement>("[data-composer-input]"))?.focus();
}
