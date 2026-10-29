// The window's chrome while a panel is in full screen (docs/desktop-modules.md §24.16, lib/panelFull): the window
// bar steps out of the layout and comes back while the pointer is at the window's top edge (or the keyboard is
// in it), and a small 「退出全屏 Esc」 hint shows for a moment on entering. Shell code: names no feature.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../i18n";
import { usePanelFull, useFullscreen } from "../lib/panelFull";
import { isNode } from "../lib/ownerWindow";
import { useOwnerWindow } from "../lib/ownerContext";

/** How long the 「退出全屏 Esc」 hint stays (ms). */
const HINT_MS = 2200;

/**
 * Wraps the window bar. Not in full screen: `display: contents` (nothing changes). In full screen: out of the
 * layout above the work row; a 6 px strip at the top edge reveals it; it hides again once the pointer has
 * moved down past it (no pointerleave: drag regions swallow pointer events on Windows).
 */
export function WindowBarFrame({ children }: { children: ReactNode }) {
  const win = useOwnerWindow();
  const full = useFullscreen();
  const [shown, setShown] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!full) setShown(false);
  }, [full]);
  useEffect(() => {
    if (!full || !shown) return;
    const onMove = (e: PointerEvent) => {
      const r = bar.current?.getBoundingClientRect();
      if (r && e.clientY > r.bottom + 12 && !bar.current?.contains(win.document.activeElement)) setShown(false);
    };
    win.addEventListener("pointermove", onMove);
    return () => win.removeEventListener("pointermove", onMove);
  }, [full, shown, win]);
  return (
    <>
      {full && !shown && <div data-window-bar-edge="" aria-hidden className="window-bar-edge" onPointerEnter={() => setShown(true)} />}
      <div
        ref={bar}
        data-window-bar-frame={full ? (shown ? "revealed" : "hidden") : undefined}
        className={full ? "window-bar-reveal" : "contents"}
        onFocusCapture={full ? () => setShown(true) : undefined}
        onBlurCapture={
          full
            ? (e) => {
                if (!(isNode(e.relatedTarget) && e.currentTarget.contains(e.relatedTarget))) setShown(false);
              }
            : undefined
        }
      >
        {children}
      </div>
    </>
  );
}

/** 「退出全屏 Esc」: once per entry into full screen, for a moment, at the top of the window. */
export function FullscreenHint() {
  const { t } = useI18n();
  const entered = usePanelFull((s) => s.entered);
  const full = useFullscreen();
  const [at, setAt] = useState<number | null>(null);
  const seen = useRef(entered);
  useEffect(() => {
    if (entered === seen.current) return;
    seen.current = entered;
    setAt(entered);
    const timer = setTimeout(() => setAt(null), HINT_MS);
    return () => clearTimeout(timer);
  }, [entered]);
  if (!full || at === null) return null;
  return (
    <div key={at} role="status" data-fullscreen-hint="" className="fullscreen-hint">
      {t("panel.exitFullscreenShort")}
      <kbd>Esc</kbd>
    </div>
  );
}
