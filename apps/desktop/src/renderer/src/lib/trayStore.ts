// The tray's reveal state while auto-hidden and panes cover the desktop (lib/trayModel, components/ChipTray):
// revealed by its handle (after a short dwell, or a click) or Ctrl/⌘+J, hidden again after use — the pointer left it,
// something was opened from it, Esc, or (shortcut) it was never used. A menu opened from it holds it.
// Shell code: names no feature.
import { create } from "zustand";
import { windowStore } from "./windowScope";
import type { AppSlotEntry } from "../modules/slots";
import { TRAY_HIDE_MS, TRAY_IDLE_MS, type TrayEdge } from "./trayModel";

export interface TrayState {
  revealed: boolean;
  /** What revealed it ("edge": the pointer; "key": Ctrl/⌘+J — the keyboard focus goes into it). */
  via: "edge" | "key" | null;
  /** The pointer is over it, or a menu opened from it is open: it stays. */
  held: boolean;
}

/** Per app window (multi-window P3, lib/windowScope). */
export const useTray = windowStore(() => create<TrayState>(() => ({ revealed: false, via: null, held: false })));

let timer: ReturnType<typeof setTimeout> | null = null;
const clear = () => {
  if (timer) clearTimeout(timer);
  timer = null;
};

/** The bottom edge / the shortcut: up it comes (a shortcut reveal hides by itself when never used). */
export function revealTray(via: "edge" | "key"): void {
  clear();
  useTray.setState({ revealed: true, via });
  if (via === "key") timer = setTimeout(() => !useTray.getState().held && hideTray(), TRAY_IDLE_MS);
}

/** Hides it now (Esc, something opened from it, the shortcut again). */
export function hideTray(): void {
  clear();
  useTray.setState({ revealed: false, via: null, held: false });
}

/** The shortcut: reveal, or hide when it is up. */
export function toggleTray(): void {
  if (useTray.getState().revealed) hideTray();
  else revealTray("key");
}

/** The pointer entered (or a menu of it opened): it stays up. */
export function holdTray(): void {
  clear();
  if (!useTray.getState().held) useTray.setState({ held: true });
}

/** The pointer left (or its menu closed): it hides after TRAY_HIDE_MS unless held again. */
export function releaseTray(ms = TRAY_HIDE_MS): void {
  clear();
  if (useTray.getState().held) useTray.setState({ held: false });
  if (!useTray.getState().revealed) return;
  timer = setTimeout(() => !useTray.getState().held && hideTray(), ms);
}

// ── What the work area tells the tray (components/ChipTray: DesktopStage → TrayFrame) ─────────────

/** The work area's desktop layer as the tray needs it; null: no work area mounted. */
export interface TrayStageState {
  /** The `pane.desktop` entry whose Dock the tray draws (null: none). */
  entry: AppSlotEntry<"pane.desktop"> | null;
  /** Its shortcuts (0: nothing to dock). */
  dockCount: number;
  /** The desktop is on screen (nothing in front). */
  desktopOn: boolean;
  /** A full-window page (设置) runs in place of the work row. */
  fullWindow: boolean;
}

/** Per app window (multi-window P3, lib/windowScope). */
export const useTrayStage = windowStore(() => create<{ stage: TrayStageState | null }>(() => ({ stage: null })));

export function publishTrayStage(stage: TrayStageState | null): void {
  const prev = useTrayStage.getState().stage;
  if (prev === stage || (prev && stage && prev.entry === stage.entry && prev.dockCount === stage.dockCount && prev.desktopOn === stage.desktopOn && prev.fullWindow === stage.fullWindow)) return;
  useTrayStage.setState({ stage });
}

// ── Dragging the tray by its grip ─────────────────────────────────────────────────────────────────

/** While the grip is dragged: the edge the tray would dock to (its drop zone lights up); null: no drag. */
export const useTrayDrag = create<{ target: TrayEdge | null }>(() => ({ target: null }));
