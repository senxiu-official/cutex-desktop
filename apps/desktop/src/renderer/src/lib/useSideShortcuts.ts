import { isImeComposing } from "./ime";
// Window-level keys of the right side (docs/desktop-modules.md §18.12 / §19), mounted once by App. Each is a
// command of lib/keybindings (the owner can rebind it in Settings → 键盘快捷键); the defaults:
//   Ctrl+Alt+B        show / hide the right column (empty side: the default components)
//   Alt+1…9           the n-th page of the focused Shelf's rail (§24.12)
//   Ctrl+Shift+1…9    the n-th page button of all rails, left Shelf first (same as clicking it)
//   Ctrl+Shift+N      new page
//   Ctrl+Shift+M      maximise the focused pane (a conversation or a tool pane) / restore (lib/paneActions)
//   Ctrl+Shift+D      显示桌面: every pane to the tray / again: the layout before
//   Ctrl+W / Ctrl+T   close the focused pane's tab / the launcher menu for a new tab in it
//   Ctrl+Alt+arrows   move the focus to the pane in that direction
//   F11 / Ctrl+Shift+F full screen of the focused panel (§24.16, lib/panelFull; Shift+F11 too) / back
//                     to the state before (lib/paneKeys → lib/paneActions)
//   F6 / Shift+F6     move focus: sidebar → conversation → page buttons → cards
//   Esc               the Esc chain's layer rows (lib/escLayers.ts): restore a maximised / full-screen
//                     pane first, else close the reference card, else close the narrow-window drawer
// Esc is not rebindable (the Esc chain).
import { useEffect } from "react";
import { shortcutKeyUsed } from "./browserCapture";
import { matchDigit, matchesCommand } from "./keybindings";
import { overlayInDom } from "./escInterrupt";
import { anyOverlayOpen } from "./openOverlays";
import { runEscChain } from "./escLayers";
import { goToPage, newPage, switchShelfPage } from "./sideActions";
import { paneKeyAction, runPaneKey } from "./paneKeys";
import { revealCurrentFile, toggleSideColumn } from "./sideOpen";
import { isElement } from "./ownerWindow";
import { useOwnerWindow } from "./ownerContext";

const REGIONS = '[data-focus-region], [data-side-lane], [data-side-strip], [data-side-card]';
const FOCUSABLE = 'textarea:not([disabled]), input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"]), a[href], select';

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** F6: the next (or previous) focus region; focuses its first editable / focusable element. */
export function cycleFocus(back: boolean, doc: Document = document): void {
  const regions = [...doc.querySelectorAll<HTMLElement>(REGIONS)].filter(visible);
  if (!regions.length) return;
  const active = doc.activeElement;
  // Focus inside an instance box counts as its card; nested regions (the reference card inside the
  // conversation card): the innermost one.
  const cardOf = isElement(active) ? active.closest<HTMLElement>("[data-side-card-of]")?.dataset.sideCardOf : undefined;
  let at = cardOf ? regions.findIndex((r) => r.dataset.sideCard === cardOf) : regions.findLastIndex((r) => r.contains(active));
  if (at < 0 && active === doc.body) at = -1;
  const next = regions[(at + (back ? -1 : 1) + regions.length * 2) % regions.length]!;
  const target =
    next.querySelector<HTMLElement>("textarea:not([disabled])") ??
    (next.dataset.sideCard ? doc.querySelector<HTMLElement>(`[data-side-card-of="${CSS.escape(next.dataset.sideCard)}"] :is(${FOCUSABLE})`) : null) ??
    next.querySelector<HTMLElement>(FOCUSABLE);
  if (target) target.focus();
  else {
    if (!next.hasAttribute("tabindex")) next.setAttribute("tabindex", "-1");
    next.focus();
  }
}

export function useSideShortcuts(enabled: boolean): void {
  const win = useOwnerWindow();
  useEffect(() => {
    if (!enabled) return;
    // Esc: popups are judged before any handler of this key press closes one (capture phase).
    let snapshot: { event: KeyboardEvent; overlay: boolean } | null = null;
    const onCapture = (e: KeyboardEvent) => {
      if (e.key === "Escape") snapshot = { event: e, overlay: anyOverlayOpen() || overlayInDom(win.document) };
    };
    const onKey = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
      if (e.key === "Escape") {
        const overlay = snapshot?.event === e ? snapshot.overlay : true;
        snapshot = null;
        runEscChain(e, overlay);
        return;
      }
      if (shortcutKeyUsed(e) || anyOverlayOpen()) return;
      const pane = paneKeyAction(e);
      if (pane) {
        if (runPaneKey(pane)) e.preventDefault();
        return;
      }
      const shelfPage = matchDigit("shelfPage", e);
      const sidePage = matchDigit("sidePage", e);
      if (matchesCommand("sideToggle", e)) {
        e.preventDefault();
        toggleSideColumn();
      } else if (matchesCommand("revealInTree", e)) {
        // 在文件树中显示 the open file (docs/design/019 §3).
        e.preventDefault();
        revealCurrentFile();
      } else if (shelfPage !== null) {
        // §24.12: the focused Shelf's n-th page (nothing there: the key goes on).
        if (switchShelfPage(shelfPage)) e.preventDefault();
      } else if (sidePage !== null) {
        e.preventDefault();
        goToPage(sidePage);
      } else if (matchesCommand("sideNewPage", e)) {
        e.preventDefault();
        newPage();
      } else if (matchesCommand("focusNext", e) || matchesCommand("focusPrev", e)) {
        e.preventDefault();
        cycleFocus(matchesCommand("focusPrev", e), win.document);
      }
    };
    win.addEventListener("keydown", onCapture, true);
    win.addEventListener("keydown", onKey);
    return () => {
      win.removeEventListener("keydown", onCapture, true);
      win.removeEventListener("keydown", onKey);
    };
  }, [enabled, win]);
}
