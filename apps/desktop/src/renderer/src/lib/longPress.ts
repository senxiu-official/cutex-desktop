// A long press on a button (§24.16: the conversation header's 「放大」 held = 全屏): the primary pointer held
// LONG_PRESS_MS without leaving runs `onLong`, and the click that follows the release is swallowed. A short
// press is the button's own click. Shell code: names no feature.
import { useRef, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";

export const LONG_PRESS_MS = 500;

export function useLongPress(onLong: () => void, ms: number = LONG_PRESS_MS) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      fired.current = false;
      cancel();
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        onLong();
      }, ms);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onClickCapture: (e: ReactMouseEvent) => {
      if (!fired.current) return;
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
