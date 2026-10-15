// A gutter item's list as a popover (docs/desktop-modules.md §19.3): by its trigger, card look, not
// modal. Closes on a click outside, Esc (it is an overlay of the Esc chain's row 1 — useTrackOverlay)
// or when the Body calls close(); focus goes back to the trigger.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n";
import { overlayInDom } from "../../lib/escInterrupt";
import type { GutterEntry } from "../../lib/gutterItems";
import { gutterPopoverPosition } from "../../lib/gutterLayout";
import { useTrackOverlay } from "../../lib/openOverlays";
import { ItemBoundary } from "../../modules/Outlet";

interface Props {
  entry: GutterEntry;
  hostId: string;
  sessionId: string;
  side: "left" | "right";
  /** The trigger it opened from (position, focus return). */
  anchor: HTMLElement;
  /** In the gutter: the card's edge to align with (px from the viewport's left / right); composer: the trigger's. */
  edge: number;
  /** The highest the popover may reach (viewport px). */
  top: number;
  width: number;
  direction?: "up" | "down";
  close(): void;
}

export function GutterPopover({ entry, hostId, sessionId, side, anchor, edge, top, width, direction = "up", close }: Props) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const measure = useCallback(() => {
    const r = anchor.getBoundingClientRect();
    return { anchorTop: r.top, anchorBottom: r.bottom, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
  }, [anchor]);
  const [position, setPosition] = useState(measure);
  const place = useCallback(() => {
    const next = measure();
    setPosition((old) => old.anchorTop === next.anchorTop && old.anchorBottom === next.anchorBottom && old.viewportWidth === next.viewportWidth && old.viewportHeight === next.viewportHeight ? old : next);
  }, [measure]);
  useTrackOverlay(true);
  // A container resize can move a trigger without resizing the trigger or the window.
  useLayoutEffect(place);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(place);
    observer.observe(anchor);
    window.addEventListener("resize", place);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); };
  }, [anchor, place]);
  // Closing from inside (Esc, the Body picked a row) puts focus back on the trigger.
  const done = useCallback(() => {
    close();
    if (anchor.isConnected) anchor.querySelector<HTMLElement>("button")?.focus();
  }, [anchor, close]);
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (box.current?.contains(target) || anchor.contains(target)) return;
      // A menu / dialog opened from the list (right-click) is not "outside".
      if (target instanceof Element && target.closest('[role="menu"],[role="dialog"],[role="alertdialog"]')) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
      // A menu opened from the list closes first.
      if (overlayInDom()) return;
      e.preventDefault();
      done();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [anchor, close, done]);
  const Body = entry.item.Body;
  if (!Body) return null;
  const style = gutterPopoverPosition({ side, direction, edge, minTop: top, width, ...position });
  return createPortal(
    <div
      ref={box}
      data-gutter-root
      data-gutter-popover={entry.item.id}
      role="group"
      aria-label={t(entry.item.titleKey)}
      className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-surface text-sm shadow-xl"
      style={style}
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        <ItemBoundary moduleId={entry.moduleId} resetKey={sessionId}>
          <Body hostId={hostId} sessionId={sessionId} width={style.width} docked={false} close={done} />
        </ItemBoundary>
      </div>
    </div>,
    document.body,
  );
}
