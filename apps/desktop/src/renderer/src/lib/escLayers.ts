// The Esc chain's layer rows (docs/desktop-modules.md §19.10, lib/escChain.ts rows 3–5), run by the
// App-level key listener (lib/useSideShortcuts.ts): close the reference card, else restore a
// maximised / full-screen side, else close the narrow-window drawer. The rows before them (popups,
// handlers that used the key) and after them (the conversation's own Esc) are decided here too, so
// one key press does one thing.
import { escChainStep, type EscChainStep } from "./escChain";
import { inSideRoot, isEditableTarget } from "./escInterrupt";
import { getUiPrefs } from "./prefs";
import { closePeek, peekOpen } from "./peekStore";
import { setOpen } from "./sideLayout";
import { setMode, updateLayout, useSide } from "./sideLayoutStore";

/** One Esc key press; `overlay` = a popup was open when it started (capture-phase snapshot). Returns the row taken. */
export function runEscChain(e: KeyboardEvent, overlay: boolean): EscChainStep {
  const s = useSide.getState();
  const active = typeof document === "undefined" ? null : document.activeElement;
  const step = escChainStep({
    modifiers: e.ctrlKey || e.altKey || e.metaKey || e.shiftKey,
    repeat: e.repeat,
    composing: e.isComposing,
    overlay,
    handled: e.defaultPrevented,
    peek: peekOpen(),
    mode: !!s.mode,
    drawer: s.narrow && s.layout.open && getUiPrefs().sideNarrow === "overlay",
    editable: isEditableTarget(e.target) || isEditableTarget(active),
    inSide: inSideRoot(e.target) || inSideRoot(active),
  });
  if (step === "close-peek") {
    e.preventDefault();
    closePeek();
  } else if (step === "restore") {
    e.preventDefault();
    setMode(null);
  } else if (step === "close-drawer") {
    e.preventDefault();
    updateLayout((l) => setOpen(l, false));
  }
  return step;
}
