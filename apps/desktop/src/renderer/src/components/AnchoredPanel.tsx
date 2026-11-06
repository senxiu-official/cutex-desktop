// A floating panel opened from a small button (design 040 浮层: rounded-inner, shadow-e2): the tray's 通知中心 and 后台操作
// lists and the status-row bell's list. Placed beside its button (lib/anchoredPanel), re-placed when it or the window
// changes size. Not modal: an outside press closes it, Esc closes it and gives focus back to the button; ↑ / ↓ move
// between its `[data-panel-row]` buttons.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { placePanel, type PanelSide } from "../lib/anchoredPanel";
import { isImeComposing } from "../lib/ime";
import { useTrackOverlay } from "../lib/openOverlays";
import { useOwnerWindow } from "../lib/ownerContext";
import { resizeObserverFor } from "../lib/ownerWindow";

export function AnchoredPanel({
  anchor,
  side,
  label,
  onClose,
  className = "w-80",
  children,
  ...data
}: {
  anchor: RefObject<HTMLElement | null>;
  side: PanelSide;
  label: string;
  /** `refocus`: give focus back to the button (Esc), not for an outside press or a row that moved on. */
  onClose(refocus: boolean): void;
  /** Width classes. */
  className?: string;
  children: ReactNode;
} & { [attr: `data-${string}`]: string | undefined }) {
  const win = useOwnerWindow();
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useTrackOverlay(true);

  useLayoutEffect(() => {
    const fit = () => {
      const a = anchor.current?.getBoundingClientRect(), box = panel.current?.getBoundingClientRect();
      if (!a || !box) return;
      const next = placePanel(a, { width: box.width, height: box.height }, side, { width: win.innerWidth, height: win.innerHeight });
      setPos((old) => (old && old.left === next.left && old.top === next.top ? old : next));
    };
    fit();
    win.addEventListener("resize", fit);
    const observer = resizeObserverFor(panel.current, fit);
    if (panel.current) observer?.observe(panel.current);
    return () => {
      win.removeEventListener("resize", fit);
      observer?.disconnect();
    };
  }, [anchor, side, win]);

  useEffect(() => {
    const doc = win.document;
    (panel.current?.querySelector<HTMLElement>("[data-panel-row]") ?? panel.current)?.focus();
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panel.current?.contains(target) || anchor.current?.contains(target)) return;
      // Menus or dialogs opened from inside the panel do not close it.
      if ((target as Element).closest?.("[role=menu],dialog[open]")) return;
      close.current(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current(true);
        anchor.current?.focus();
      } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && panel.current?.contains(doc.activeElement)) {
        const rows = [...panel.current.querySelectorAll<HTMLElement>("[data-panel-row]")];
        const i = rows.indexOf(doc.activeElement as HTMLElement);
        const next = rows[e.key === "ArrowDown" ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1)];
        if (next) {
          e.preventDefault();
          next.focus();
        }
      }
    };
    doc.addEventListener("mousedown", onDown);
    doc.addEventListener("keydown", onKey, true);
    return () => {
      doc.removeEventListener("mousedown", onDown);
      doc.removeEventListener("keydown", onKey, true);
    };
  }, [win, anchor]);

  return createPortal(
    <div
      {...data}
      ref={panel}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      data-side={side}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, maxHeight: "calc(100dvh - 32px)" }}
      className={`float fixed z-[160] flex max-w-[calc(100vw-32px)] flex-col overflow-hidden text-ui outline-none ${className}`}
    >
      {children}
    </div>,
    win.document.body,
  );
}
