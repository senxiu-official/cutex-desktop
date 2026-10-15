// Count of open composer-area popovers (menus, goal / background lists). Esc in the composer
// interrupts the running turn only when none is open — otherwise Esc just closes that popover.
import { useEffect } from "react";

let open = 0;

export function anyOverlayOpen(): boolean {
  return open > 0;
}

export function useTrackOverlay(isOpen: boolean): void {
  useEffect(() => {
    if (!isOpen) return;
    open++;
    return () => {
      open--;
    };
  }, [isOpen]);
}
