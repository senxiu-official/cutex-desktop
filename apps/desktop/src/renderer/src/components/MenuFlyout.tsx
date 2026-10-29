import { useContext, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOwnerWindow } from "../lib/ownerContext";
import { resizeObserverFor } from "../lib/ownerWindow";
import { placeFlyout, samePlace, type FlyoutPlace } from "../lib/flyoutPlacement";
import { MenuLayersContext, useMenuLayer } from "../lib/menuLayers";

/** Portalled to its own window so pane and parent-menu scrolling cannot clip a submenu. */
export function MenuFlyout({ children, className = "min-w-40", align = "top" }: { children: ReactNode; className?: string; align?: "top" | "bottom" }) {
  const marker = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const win = useOwnerWindow();
  const group = useContext(MenuLayersContext);
  useMenuLayer(panel, group);
  useLayoutEffect(() => {
    const el = panel.current, row = marker.current?.parentElement;
    if (!el || !row) return;
    let current: FlyoutPlace | undefined;
    const update = () => {
      const next = placeFlyout(row.getBoundingClientRect(), { width: el.offsetWidth, height: el.offsetHeight }, { width: win.innerWidth, height: win.innerHeight }, current, align);
      if (current && samePlace(current, next)) return;
      current = next;
      el.style.left = `${next.left}px`; el.style.top = `${next.top}px`;
      el.style.paddingLeft = next.side === "right" ? "4px" : "";
      el.style.paddingRight = next.side === "left" ? "4px" : "";
    };
    update();
    const observer = resizeObserverFor(el, update);
    observer?.observe(el); observer?.observe(row);
    // Inner scrolling changes visible rows, not placement; outside wheel/touch dismisses the menu.
    win.addEventListener("resize", update);
    return () => { observer?.disconnect(); win.removeEventListener("resize", update); };
  }, [win, align]);
  return <><span ref={marker} hidden />{createPortal(<div ref={panel} data-flyout="" data-popover="" className="fixed z-[52]" style={{ paddingLeft: 4, maxWidth: "calc(100vw - 8px)", maxHeight: "calc(100dvh - 8px)" }}>
    <div role="menu" className={`max-h-[calc(100dvh-8px)] max-w-[calc(100vw-12px)] overflow-y-auto rounded-xl border border-border bg-surface p-1 text-sm shadow-xl ${className}`} style={{ minWidth: "min(10rem, calc(100vw - 12px))", overflowWrap: "anywhere" }}>{children}</div>
  </div>, win.document.body)}</>;
}
