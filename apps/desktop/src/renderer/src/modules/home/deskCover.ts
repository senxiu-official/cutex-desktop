// How much of the desktop a Shelf covers (owner 2026-11-10). The desktop layer is never squeezed (contract 1.20): a
// Shelf (or the Settings Shelf) floats over its side, so the widgets under it were cut off. DeskSurface reflows the
// saved layout into the columns left free (deskCells reflowCells, a view only); this hook measures the cover: the
// px of the desk area's width under Shelf cards on its left and on its right, re-measured when the tool area or the
// Settings Shelf changes, the window resizes, or a Shelf card resizes (its glide, a drag of its edge).
import { useEffect, useState, type RefObject } from "react";
import { useSide } from "../../lib/sideLayoutStore";
import { useSettingsShelf } from "../../lib/settingsShelf";
import { coverOf, type DeskCover } from "./deskCells";

const NONE: DeskCover = { left: 0, right: 0 };

/** What covers the desktop: the Shelf cards (open or folded to their rail) and the Settings Shelf. */
const COVERS = "[data-shelf], [data-settings-shelf]";

export function useDeskCover(area: RefObject<HTMLElement | null>, on: boolean): DeskCover {
  const [cover, setCover] = useState<DeskCover>(NONE);
  const sideLayout = useSide((s) => s.layout);
  const settingsOpen = useSettingsShelf((s) => s.open);
  useEffect(() => {
    const el = area.current;
    if (!on || !el) {
      setCover(NONE);
      return;
    }
    const doc = el.ownerDocument;
    const win = doc.defaultView;
    if (!win) return;
    const watched = new Set<Element>();
    let frame = 0;
    const measure = () => {
      frame = 0;
      const covers = [...doc.querySelectorAll(COVERS)];
      for (const c of covers) if (!watched.has(c)) (watched.add(c), ro.observe(c));
      // The visible part of the area (it may scroll taller than the window).
      const a = el.getBoundingClientRect();
      const next = coverOf({ left: a.left, right: a.right, top: Math.max(a.top, 0), bottom: Math.min(a.bottom, win.innerHeight) }, covers.map((c) => c.getBoundingClientRect()));
      setCover((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
    };
    const soon = () => {
      if (!frame) frame = win.requestAnimationFrame(measure);
    };
    const ro = new win.ResizeObserver(soon);
    ro.observe(el);
    win.addEventListener("resize", soon);
    measure();
    // A Shelf opening glides in: measure again once it has settled.
    const late = win.setTimeout(measure, 400);
    return () => {
      ro.disconnect();
      win.removeEventListener("resize", soon);
      win.clearTimeout(late);
      if (frame) win.cancelAnimationFrame(frame);
    };
  }, [area, on, sideLayout, settingsOpen]);
  return cover;
}
