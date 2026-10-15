// Sidebar project flyout (components/ProjectFlyout): the hover preview of a project shown collapsed.
// One rule for every collapsed project row — auto-collapsed (nothing online, 其他项目, a folded
// section's 需要你 list) or folded by the user with the chevron: hovering it previews its agents
// beside the sidebar. An expanded project never shows one (its agents are already listed).
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useTrackOverlay } from "./openOverlays";

/** Settings → 外观 → 侧栏 「悬停预览延迟」 (ms). */
export const FLYOUT_DELAYS = [120, 300, 600] as const;
export type FlyoutDelay = (typeof FLYOUT_DELAYS)[number];
export const DEFAULT_FLYOUT_DELAY: FlyoutDelay = 120;
/** Grace period after the pointer leaves the row / flyout, so it can travel between them. */
export const FLYOUT_CLOSE_DELAY = 180;

export function migrateFlyoutDelay(v: unknown): FlyoutDelay {
  return (FLYOUT_DELAYS as readonly unknown[]).includes(v) ? (v as FlyoutDelay) : DEFAULT_FLYOUT_DELAY;
}

export interface FlyoutRule {
  /** The project shows as one collapsed row (auto-collapsed or folded by the user). */
  collapsed: boolean;
  /** Settings 「收起的项目悬停预览」. */
  hoverPreview: boolean;
  /** A project is being dragged (no previews pop up under the drag). */
  dragging: boolean;
}

/**
 * A project shows as one collapsed row when the layout collapsed it (nothing online, 其他项目, a
 * folded section's 需要你 list) or the user folded it with the chevron — never by its online count.
 */
export function isCollapsedRow(layout: { mode: "full" | "collapsed" }, userFolded: boolean): boolean {
  return layout.mode === "collapsed" || userFolded;
}

/** Whether hovering this project row opens its flyout. */
export function hoverOpensFlyout(rule: FlyoutRule): boolean {
  return rule.collapsed && rule.hoverPreview && !rule.dragging;
}

/** Sidebar-wide gate for flyouts (Sidebar provides it; default: nothing suppressed). */
export const FlyoutGateContext = createContext<{ dragging: boolean }>({ dragging: false });

export function useFlyoutGate(): { dragging: boolean } {
  return useContext(FlyoutGateContext);
}

export interface ProjectFlyoutState {
  rowRef: React.RefObject<HTMLDivElement | null>;
  flyRef: React.RefObject<HTMLDivElement | null>;
  open: boolean;
  pinned: boolean;
  rect: DOMRect | null;
  /** Pointer handlers for the row and the flyout (hover with open delay / close grace). */
  hover: { onMouseEnter(): void; onMouseLeave(): void };
  flyHover: { onMouseEnter(): void; onMouseLeave(): void };
  /** Pin open / unpin (click on an auto-collapsed row, ArrowRight on any collapsed row). */
  setPinned(next: boolean): void;
  close(): void;
  /** ArrowRight opens (pinned) and focuses the flyout's first agent; Esc / ArrowLeft close it. */
  onKeyDown(e: React.KeyboardEvent): void;
}

/**
 * Hover / pin state of one project's flyout. `hoverEnabled` = hoverOpensFlyout(...); `available`
 * = the row is collapsed at all (an expanded or dragged project closes any open flyout).
 */
export function useProjectFlyout({ available, hoverEnabled, delay }: { available: boolean; hoverEnabled: boolean; delay: number }): ProjectFlyoutState {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const flyRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinnedState] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const open = available && (hovered || pinned);
  // An open flyout takes Esc (closes) instead of the conversation stopping the turn.
  useTrackOverlay(open);

  const measure = () => rowRef.current && setRect(rowRef.current.getBoundingClientRect());
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const schedule = (next: boolean, ms: number) => {
    clear();
    timer.current = setTimeout(() => {
      if (next) measure();
      setHovered(next);
    }, ms);
  };
  const close = () => {
    clear();
    setHovered(false);
    setPinnedState(false);
  };
  const setPinned = (next: boolean) => {
    if (next) measure();
    setPinnedState(next);
    setHovered(next);
  };
  useEffect(() => clear, []);
  // Expanded, dragged or turned off: drop any open / pending flyout.
  useEffect(() => {
    if (!available) close();
    else if (!hoverEnabled) {
      clear();
      setHovered(false);
    }
  }, [available, hoverEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rowRef.current?.contains(target) || flyRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const inside = flyRef.current?.contains(document.activeElement);
      close();
      if (inside) rowRef.current?.querySelector("button")?.focus();
    };
    // The flyout is placed from the row's position when it opened: scrolling the sidebar closes it.
    const onScroll = (e: Event) => {
      // Only a scroll that moves the row (the sidebar list); a streaming conversation keeps it open.
      if (e.target instanceof Node && rowRef.current && e.target.contains(rowRef.current)) close();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!available) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setPinned(true);
      requestAnimationFrame(() => flyRef.current?.querySelector<HTMLElement>("[data-flyout-list] > [role=button], [data-flyout-list] > button:not(:disabled)")?.focus());
    } else if (e.key === "ArrowLeft" && open) {
      e.preventDefault();
      close();
    }
  };

  return {
    rowRef,
    flyRef,
    open,
    pinned,
    rect,
    hover: {
      onMouseEnter: () => hoverEnabled && schedule(true, delay),
      onMouseLeave: () => (pinned ? clear() : schedule(false, FLYOUT_CLOSE_DELAY)),
    },
    flyHover: {
      onMouseEnter: () => clear(),
      onMouseLeave: () => !pinned && schedule(false, FLYOUT_CLOSE_DELAY),
    },
    setPinned,
    close,
    onKeyDown,
  };
}
