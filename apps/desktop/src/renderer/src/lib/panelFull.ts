// Maximise and full screen of any panel (docs/desktop-modules.md §24.16; owner 2026-10-21 「面板没有最大化 /
// 全屏吗？」). The kinds: a conversation column, a whole Shelf, a pane in a Shelf.
//   最大化  the panel takes the rest of the work row: the sidebar card and the tray stay as they are, every other
//           panel folds to its rail (the same workspace's Shelves; the other workspace as its rail with its
//           avatar; the conversations beside a maximised Shelf / pane as a strip of avatars). A view only: the
//           layouts are not changed, so a second toggle / Esc / a double-click puts back exactly what was there.
//           State: a conversation `PaneLayout.max` (lib/paneLayout), a Shelf / pane `useSide.mode` (`shelf` /
//           `card`).
//   全屏    the same, and the window's chrome steps back: the sidebar folds to its rail (it stays, to switch),
//           the tray hides (its handle stays), the window bar is revealed by hovering the top edge, the Settings
//           Shelf leaves. F11 / Ctrl/⌘+Shift+F; Esc (after the inner layers) goes back to exactly the state
//           before (a maximised panel stays maximised). State: here (`target`, `before`); the tool area's
//           `mode.kind === "fullscreen"`.
// Neither is stored: a restart starts with nothing maximised.
// Shell code: names no feature.
import { create } from "zustand";
import { windowStore } from "./windowScope";
import { conversationPanes, focusPane } from "./paneLayout";
import { setPaneLayout, usePanes } from "./paneStore";
import { findCard, findShelf, setOpen } from "./sideLayout";
import { setFullscreenHooks, setMode, updateLayout, useSide, type SideMode } from "./sideLayoutStore";

/** A panel that can be maximised / full screen: a conversation pane, or a tool pane / the page in view / a whole Shelf. */
export type PanelTarget = { area: "work"; id: string } | { area: "tools"; card: string | null; shelf?: string | null };

/** What full screen goes back to. */
export interface PanelBefore {
  /** The maximised conversation pane then. */
  max: string | null;
  /** The tool area's mode then. */
  mode: SideMode | null;
}

interface PanelFullState {
  /** The panel in full screen (null: none). */
  target: PanelTarget | null;
  before: PanelBefore | null;
  /** Bumped on entering full screen (the 「退出全屏 Esc」 hint shows once per entry). */
  entered: number;
}

/** Per app window (multi-window P3, lib/windowScope). */
export const usePanelFull = windowStore(() => create<PanelFullState>(() => ({ target: null, before: null, entered: 0 })));

// ── Pure ────────────────────────────────────────────────────────────────────────────────────────

export const sameTarget = (a: PanelTarget | null, b: PanelTarget | null): boolean =>
  !!a && !!b && (a.area === "work" ? b.area === "work" && a.id === b.id : b.area === "tools" && a.card === b.card && (a.shelf ?? null) === (b.shelf ?? null));

/** Whether full screen of `target` still holds in the stores (else something else changed the layout: it ends). */
export function fullscreenHolds(target: PanelTarget, mode: SideMode | null, max: string | null): boolean {
  if (target.area === "work") return max === target.id && !mode;
  return mode?.kind === "fullscreen" && mode.card === target.card && (mode.shelf ?? null) === (target.shelf ?? null);
}

/** The target of a full-screen tool mode set elsewhere (a module's `side.open` target, the reference card's ⛶). */
export const targetOfMode = (mode: SideMode): PanelTarget => ({ area: "tools", card: mode.card, shelf: mode.shelf ?? null });

/** What exiting full screen puts back: the mode / maximised pane before, when they still exist. */
export function restoredState(before: PanelBefore | null, panes: readonly string[], valid: (mode: SideMode) => boolean): PanelBefore {
  const max = before?.max && panes.includes(before.max) ? before.max : null;
  const mode = before?.mode && before.mode.kind !== "fullscreen" && valid(before.mode) ? before.mode : null;
  return { max, mode };
}

// ── Store side ──────────────────────────────────────────────────────────────────────────────────

/** Full screen is on (a panel's, or a tool mode set elsewhere not yet adopted). */
export function fullscreenOn(): boolean {
  return !!usePanelFull.getState().target || useSide.getState().mode?.kind === "fullscreen";
}

export function useFullscreen(): boolean {
  const own = usePanelFull((s) => !!s.target);
  const tool = useSide((s) => s.mode?.kind === "fullscreen");
  return own || tool;
}

let busy = false;

function snapshot(): PanelBefore {
  return { max: usePanes.getState().layout.max, mode: useSide.getState().mode };
}

/** Full screen for a panel (from any state; the state before the first one is what Esc goes back to). False: nothing to show. */
export function enterFullscreen(target: PanelTarget): boolean {
  hook();
  const s = usePanelFull.getState();
  const before = s.target ? s.before : snapshot();
  busy = true;
  try {
    if (target.area === "work") {
      if (!conversationPanes(usePanes.getState().layout).includes(target.id)) return false;
      if (useSide.getState().mode) setMode(null);
      setPaneLayout((l) => focusPane(l.max === target.id ? l : { ...l, max: target.id }, target.id, Date.now()));
    } else {
      const side = useSide.getState();
      if (!side.layout.pages.length) return false;
      if (target.card && !findCard(side.layout, target.card)) return false;
      if (target.shelf && !findShelf(side.layout, target.shelf)) return false;
      if (usePanes.getState().layout.max) setPaneLayout((l) => ({ ...l, max: null }));
      if (!side.layout.open) updateLayout((l) => setOpen(l, true));
      setMode({ kind: "fullscreen", card: target.card, shelf: target.shelf ?? null });
      if (useSide.getState().mode?.kind !== "fullscreen") return false;
    }
    usePanelFull.setState({ target, before, entered: s.entered + 1 });
    return true;
  } finally {
    busy = false;
  }
}

/** Leaves full screen: back to exactly the state before it (a panel maximised then is maximised again). */
export function exitFullscreen(): boolean {
  const { target, before } = usePanelFull.getState();
  if (!target && useSide.getState().mode?.kind !== "fullscreen") return false;
  busy = true;
  try {
    usePanelFull.setState({ target: null, before: null });
    const layout = useSide.getState().layout;
    const back = restoredState(before, conversationPanes(usePanes.getState().layout), (m) => (m.card ? !!findCard(layout, m.card) : m.shelf ? !!findShelf(layout, m.shelf) : true));
    setMode(back.mode);
    setPaneLayout((l) => (l.max === back.max ? l : { ...l, max: back.max }));
  } finally {
    busy = false;
  }
  return true;
}

/** F11 / Ctrl/⌘+Shift+F / 「全屏」: full screen for the panel, or (it is the one in full screen) back. */
export function toggleFullscreen(target: PanelTarget): boolean {
  const s = usePanelFull.getState();
  if (s.target ? sameTarget(s.target, target) : useSide.getState().mode?.kind === "fullscreen") return exitFullscreen();
  return enterFullscreen(target);
}

/** A click on a folded rail / the avatar strip while a panel is maximised / full screen: everything back to normal. */
export function restorePanels(): void {
  busy = true;
  try {
    usePanelFull.setState({ target: null, before: null });
    if (useSide.getState().mode) setMode(null);
    if (usePanes.getState().layout.max) setPaneLayout((l) => ({ ...l, max: null }));
  } finally {
    busy = false;
  }
}

/** Keeps full screen in step with the stores: it ends when its panel is no longer maximised; a tool full screen set elsewhere is adopted. */
function check(): void {
  if (busy) return;
  const { target } = usePanelFull.getState();
  const mode = useSide.getState().mode;
  const max = usePanes.getState().layout.max;
  if (!target) {
    if (mode?.kind === "fullscreen") usePanelFull.setState({ target: targetOfMode(mode), before: { max: null, mode: null }, entered: usePanelFull.getState().entered + 1 });
    return;
  }
  if (!fullscreenHolds(target, mode, max)) usePanelFull.setState({ target: null, before: null });
}

// The Esc layer's restore (lib/sideLayoutStore) learns about full screen when it first can be on (not at module
// load: sideLayoutStore → … → sideActions → here is an import cycle).
let hooked = false;
function hook(): void {
  if (hooked) return;
  hooked = true;
  setFullscreenHooks({ on: fullscreenOn, exit: () => void exitFullscreen() });
}

let started = false;
/** App start (lib/paneActions startPaneActions). */
export function startPanelFull(): () => void {
  if (started) return () => {};
  started = true;
  hook();
  const offA = usePanes.subscribe(check);
  const offB = useSide.subscribe(check);
  return () => {
    started = false;
    offA();
    offB();
  };
}

/** Tests: back to nothing. */
export function resetPanelFull(): void {
  usePanelFull.setState({ target: null, before: null, entered: 0 });
}
