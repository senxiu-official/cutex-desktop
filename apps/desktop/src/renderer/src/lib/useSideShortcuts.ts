// Window-level keys of the right side (docs/desktop-modules.md §18.12 / §19), mounted once by App:
//   Ctrl+Alt+B        show / hide the right column (empty side: the default components)
//   Ctrl+Shift+1…9    the n-th page button (same as clicking it: the page in view again = 点击当前页图标)
//   Ctrl+Shift+N      new page
//   Ctrl+Shift+M      maximise the focused card (else the page in view) / restore
//   Shift+F11         full screen, same target / restore
//   F6 / Shift+F6     move focus: sidebar → conversation → page buttons → cards
//   Esc               the Esc chain's layer rows (lib/escLayers.ts): close the reference card, else
//                     restore a maximised / full-screen side, else close the narrow-window drawer
// Listed in lib/shortcuts.ts (Settings → 键盘快捷键). Uses KeyboardEvent.code for digits / letters so
// Shift and keyboard layouts do not change them.
import { useEffect } from "react";
import { shortcutKeyUsed } from "./browserCapture";
import { overlayInDom } from "./escInterrupt";
import { anyOverlayOpen } from "./openOverlays";
import { runEscChain } from "./escLayers";
import { goToPage, newPage, toggleModeForFocus } from "./sideActions";
import { toggleSideColumn } from "./sideOpen";

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
  const cardOf = active instanceof Element ? active.closest<HTMLElement>("[data-side-card-of]")?.dataset.sideCardOf : undefined;
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
  useEffect(() => {
    if (!enabled) return;
    // Esc: popups are judged before any handler of this key press closes one (capture phase).
    let snapshot: { event: KeyboardEvent; overlay: boolean } | null = null;
    const onCapture = (e: KeyboardEvent) => {
      if (e.key === "Escape") snapshot = { event: e, overlay: anyOverlayOpen() || overlayInDom() };
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") {
        const overlay = snapshot?.event === e ? snapshot.overlay : true;
        snapshot = null;
        runEscChain(e, overlay);
        return;
      }
      if (shortcutKeyUsed(e) || anyOverlayOpen()) return;
      if (mod && e.altKey && !e.shiftKey && e.code === "KeyB") {
        e.preventDefault();
        toggleSideColumn();
      } else if (mod && e.shiftKey && !e.altKey && /^Digit[1-9]$/.test(e.code)) {
        e.preventDefault();
        goToPage(Number(e.code.slice(5)));
      } else if (mod && e.shiftKey && !e.altKey && e.code === "KeyN") {
        e.preventDefault();
        newPage();
      } else if (mod && e.shiftKey && !e.altKey && e.code === "KeyM") {
        e.preventDefault();
        toggleModeForFocus("maximised");
      } else if (e.key === "F11" && e.shiftKey && !mod && !e.altKey) {
        e.preventDefault();
        toggleModeForFocus("fullscreen");
      } else if (e.key === "F6" && !mod && !e.altKey) {
        e.preventDefault();
        cycleFocus(e.shiftKey);
      }
    };
    window.addEventListener("keydown", onCapture, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onCapture, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [enabled]);
}
