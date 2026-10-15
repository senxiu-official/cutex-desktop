// The Esc chain (docs/desktop-modules.md §19.10; RFC §7.10): one key press does one thing, the first
// matching row wins.
//   –  a drag on the right side runs                            → cancel it, nothing else (lib/sideDnd.ts:
//                                                                  a window capture listener added when
//                                                                  that module loads sees the key first)
//   0  modifiers / key repeat / IME composition                 → nothing
//   1  a menu, dialog, popover (gutter lists), palette, composer
//      panel or pending interaction card is open                → theirs (they close themselves)
//   2  focus in a component that handles Esc itself (it called
//      preventDefault: side chat stop, search clear, xterm …)   → theirs
//   3  the reference card is open and on screen (a maximised /
//      full-screen side hides it: row 4 first, then it is back) → close it (focus goes back)
//   4  the right side is maximised / full screen                → restore
//   5  the narrow-window drawer is open, focus not editable     → close the drawer
//   6  focus in the right side / a gutter (not editable)        → nothing: never a turn interrupt
//   7  the conversation                                         → its own Esc (lib/escInterrupt.ts)
// Rows 3–5 run in one App-level listener (lib/escLayers.ts); the composer and the conversation's
// window listener stand back while any of them applies (sideLayersActive()). Pure.

export interface EscChainInput {
  /** Ctrl / Alt / Shift / Meta held. */
  modifiers: boolean;
  repeat: boolean;
  composing: boolean;
  /** Row 1: an overlay was open when the key press started (snapshot). */
  overlay: boolean;
  /** Row 2: another handler already used the key (defaultPrevented). */
  handled: boolean;
  /** Row 3: a reference card is open (hidden while `mode` covers the conversation). */
  peek: boolean;
  /** Row 4: the right side is maximised / full screen. */
  mode: boolean;
  /** Row 5: the narrow-window drawer is open over the conversation. */
  drawer: boolean;
  /** Focus (or the key's target) is a text input / textarea / contenteditable. */
  editable: boolean;
  /** Focus (or the key's target) is inside the right side or a gutter (incl. the reference card). */
  inSide: boolean;
}

export type EscChainStep = "ignore" | "overlay" | "handled" | "close-peek" | "restore" | "close-drawer" | "side" | "conversation";

export function escChainStep(i: EscChainInput): EscChainStep {
  if (i.modifiers || i.repeat || i.composing) return "ignore";
  if (i.overlay) return "overlay";
  if (i.handled) return "handled";
  // Typing in a right-side / gutter input (a side chat, a search box) keeps the reference card. A
  // maximised / full-screen side hides it: Esc restores first (closing an unseen card would look like
  // nothing happened, and it would not come back with the conversation).
  if (i.peek && !i.mode && !(i.editable && i.inSide)) return "close-peek";
  if (i.mode) return "restore";
  if (i.drawer && !i.editable) return "close-drawer";
  if (i.inSide) return "side";
  return "conversation";
}
