// Hooks of the title-bar launcher bar (docs/desktop-modules.md §18.3; rules in lib/sideLaunchers.ts).
// Shell code: no feature names.
import { useLayoutEffect, useState, type RefObject } from "react";
import { useApp } from "../store";
import { useUiPrefs } from "./prefs";
import { useSideRegistry } from "./sideComponents";
import { fitLaunchers, splitLaunchers } from "./sideLaunchers";
import { launchable, type Launchable } from "./sideMenus";
import { sharedResizeObserver } from "./resizeHub";

/** Width of one launcher button incl. its gap (h-7 w-7 + gap-0.5). */
export const LAUNCHER_SIZE = 30;
/** What the agent title keeps before pinned launchers start to move into the ＋ menu. */
export const TITLE_MIN = 240;

/** Launchable components, pinned (title bar) and the rest (＋ menu only), each by `launcher.order`. */
export function useLaunchers(): { pinned: Launchable[]; others: Launchable[] } {
  useSideRegistry(); // components come and go
  // A launcher's params follow the selected agent (e.g. only with a workspace).
  useApp((s) => s.selectedId);
  useApp((s) => s.sidebar);
  const { sideLauncherPins } = useUiPrefs();
  return splitLaunchers(launchable(), sideLauncherPins);
}

/**
 * How many of `count` pinned launchers fit (narrow windows: the rest collapse into the ＋ menu; the
 * side toggle always stays). Room = the title's width + the strip's width − TITLE_MIN: the title area
 * (`[data-titlebar-title]`, flex-1) takes what the strip gives up, so the sum stays put while the count changes.
 */
export function useLauncherFit(strip: RefObject<HTMLElement | null>, count: number): number {
  // The fitted count is the state, not the room: the room changes on every step of a window resize, and keeping it
  // re-rendered the whole launcher bar per step (perf audit 2026-10-23 #28). Measured before paint, so a changed
  // count never shows the old fit for a frame.
  const [fit, setFit] = useState(count);
  useLayoutEffect(() => {
    const el = strip.current;
    const title = el?.closest("header")?.querySelector<HTMLElement>("[data-titlebar-title]");
    if (!el || !title || typeof ResizeObserver === "undefined") {
      setFit(count);
      return;
    }
    const measure = () => setFit(fitLaunchers(title.getBoundingClientRect().width + el.getBoundingClientRect().width - TITLE_MIN, count, LAUNCHER_SIZE));
    const observer = sharedResizeObserver(measure);
    observer.observe(title);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, [strip, count]);
  return Math.min(fit, count);
}
