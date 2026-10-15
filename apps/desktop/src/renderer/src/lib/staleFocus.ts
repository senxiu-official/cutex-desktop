// Keyboard focus left on an item that is no longer the selected one (owner 2026-10-15: "the blue edge
// highlight is sometimes in the wrong place" — sidebar rows, the right side's page buttons and tabs).
// Chromium draws its focus ring on the focused element once the last input was a key, so after a click
// on row A and a switch by shortcut / notification / 需要你 to B, the ring stayed on A. When the
// selection changes, a focused item that is now unselected gives up focus; moving focus between items
// with Tab (no selection change) is untouched.
import { useEffect } from "react";
import { useSide } from "./sideLayoutStore";
import { useApp } from "../store";

/** Selection items: page buttons and card tabs (role=tab), sidebar rows (data-row-selectable). */
const STALE = '[role="tab"][aria-selected="false"], [data-row-selectable]:not([data-row-selected])';

export function dropStaleFocus(): void {
  // After React has committed the new selection.
  requestAnimationFrame(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement && el.matches(STALE)) el.blur();
  });
}

/** Mounted once by App.tsx. */
export function useStaleFocusGuard(): void {
  useEffect(() => {
    const offSide = useSide.subscribe((s, prev) => {
      if (s.layout !== prev.layout) dropStaleFocus();
    });
    const offApp = useApp.subscribe((s, prev) => {
      if (s.selectedId !== prev.selectedId || s.selectedHost !== prev.selectedHost || s.view !== prev.view) dropStaleFocus();
    });
    return () => {
      offSide();
      offApp();
    };
  }, []);
}
