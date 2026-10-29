// Desk windows' document-level guards (multi-window P2): what main.tsx installs on this document at start —
// IME composition guards, the content-selection scope, looping animations in one phase and resting while the
// window is not in front — installed on each desk document too (lib/deskSync, behind the desks flag). A desk's
// overlay scrollbars come with them (lib/overlayScrollbarManager, per window).
//
// Not here: the zoom keys (the Electron zoom factor is the main window's webContents only) and the error log
// (a desk's handlers run in this realm, so their errors already reach this window's handlers).
import { installAnimationPhase } from "./animationPhase";
import { installContentSelection } from "./contentSelection";
import { installImeGuards } from "./ime";
import { installLoopPause } from "./loopPause";
import { installOverlayScrollbars } from "./overlayScrollbarManager";

/** Install the guards on desk window `win`; returns their removal. Never for this (the main) window. */
export function installDeskGuards(win: Window): () => void {
  if (win === window) return () => {};
  const doc = win.document;
  // Overlay scrollbars first, as in main.tsx: their capture listeners run before the app's outside-click handlers.
  const offs = [installOverlayScrollbars(win), installImeGuards(doc), installContentSelection(doc), installAnimationPhase(doc), installLoopPause(win, doc)];
  return () => {
    for (const off of offs.reverse()) {
      try {
        off();
      } catch {
        // the window is gone already
      }
    }
  };
}
