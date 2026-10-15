// "Open a NEW instance instead of replacing", app-wide, on the browser convention (owner 2026-10-12):
// Ctrl/⌘ + click or middle click = a new, kept (non-transient) tab in the background (no focus, the
// current tab stays in view); Ctrl/⌘ + Shift + click = the same, focused. Plain click = unchanged
// (reuse / replace the transient preview). Keyboard: Ctrl/⌘ + Enter on a focused row = Ctrl/⌘ + click.
import { bridge } from "../bridge";
import type { SideOpenOptions } from "../modules/slots";

export interface OpenModifiers {
  /** Open a new kept instance / tab instead of reusing or replacing. */
  newInstance: boolean;
  /** Take focus (show it). False = background. */
  focus: boolean;
}

export const PLAIN_OPEN: OpenModifiers = { newInstance: false, focus: true };

interface ModifierEvent {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  /** Mouse button (1 = middle); absent for keyboard events. */
  button?: number;
}

/** The modifiers of a click / auxclick / Enter key event. `mac`: ⌘ instead of Ctrl. */
export function openModifiers(e: ModifierEvent, mac: boolean = isMac()): OpenModifiers {
  const mod = mac ? e.metaKey : e.ctrlKey;
  if (!mod && e.button !== 1) return PLAIN_OPEN;
  return { newInstance: true, focus: e.shiftKey };
}

/** Side-open options for a new-instance open: kept (pinned), background unless focused. */
export function newInstanceOpts(mods: OpenModifiers): SideOpenOptions {
  if (!mods.newInstance) return {};
  return mods.focus ? { pin: true, focus: true } : { pin: true, background: true };
}

export function isMac(): boolean {
  return (bridge as { platform?: string } | undefined)?.platform === "darwin";
}

/** The modifier as shown in hints: "Ctrl+" or "⌘+". */
export function newInstanceKey(mac: boolean = isMac()): string {
  return mac ? "⌘+" : "Ctrl+";
}

/** Ctrl/⌘ + Enter on a focused row: the same as Ctrl/⌘ + click. Returns the modifiers, or null for other keys. */
export function enterModifiers(e: ModifierEvent & { key: string }, mac: boolean = isMac()): OpenModifiers | null {
  if (e.key !== "Enter") return null;
  const mods = openModifiers(e, mac);
  return mods.newInstance ? mods : null;
}
