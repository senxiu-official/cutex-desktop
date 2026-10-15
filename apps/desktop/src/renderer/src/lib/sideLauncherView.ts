// Hooks of the title-bar launcher bar (docs/desktop-modules.md §18.3; rules in lib/sideLaunchers.ts).
// Shell code: no feature names.
import { useEffect, useState, type RefObject } from "react";
import { useApp } from "../store";
import { useUiPrefs } from "./prefs";
import { useSideRegistry } from "./sideComponents";
import { fitLaunchers, splitLaunchers } from "./sideLaunchers";
import { launchable, type Launchable } from "./sideMenus";

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
  const [room, setRoom] = useState(Number.POSITIVE_INFINITY);
  useEffect(() => {
    const el = strip.current;
    const title = el?.closest("header")?.querySelector<HTMLElement>("[data-titlebar-title]");
    if (!el || !title || typeof ResizeObserver === "undefined") return;
    const measure = () => setRoom(title.getBoundingClientRect().width + el.getBoundingClientRect().width - TITLE_MIN);
    const observer = new ResizeObserver(measure);
    observer.observe(title);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, [strip]);
  return fitLaunchers(room, count, LAUNCHER_SIZE);
}
