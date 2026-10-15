import { useLayoutEffect, useRef, useState } from "react";
import { chipIsCompact, type ChipFit, type StatusChips } from "./statusChips";

/**
 * 状态标签 自动 for one agent row: measures its first line (ResizeObserver) and decides with
 * `chipIsCompact`. Mark the line with `lineRef`, the name with `data-fit-name`, the chip slot with
 * `data-fit-chip` (it holds an invisible copy of the text chip, `data-fit-measure`), and anything to
 * leave out (the hover-only ⋯) with `data-fit-skip`.
 */
export function useChipFit(pref: StatusChips, deps: readonly unknown[]) {
  const lineRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<ChipFit | null>(null);
  useLayoutEffect(() => {
    const line = lineRef.current;
    if (pref !== "auto" || !line) return;
    const measure = () => setFit((prev) => {
      const next = measureLine(line);
      return prev && next && Math.abs(prev.lineWidth - next.lineWidth) < 0.5 && prev.nameWidth === next.nameWidth && prev.otherWidth === next.otherWidth && prev.chipWidth === next.chipWidth ? prev : next;
    });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(line);
    // The text copy changes width with the language / font without the line resizing.
    const copy = line.querySelector("[data-fit-measure]");
    if (copy) ro.observe(copy);
    return () => ro.disconnect();
  }, [pref, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { lineRef, compact: chipIsCompact(pref, fit) };
}

function measureLine(line: HTMLElement): ChipFit | null {
  const chip = line.querySelector<HTMLElement>("[data-fit-measure]");
  const name = line.querySelector<HTMLElement>("[data-fit-name]");
  if (!chip || !name) return null;
  const style = getComputedStyle(line);
  const gap = parseFloat(style.columnGap) || 0;
  let other = 0;
  let items = 0;
  for (const el of Array.from(line.children) as HTMLElement[]) {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.position === "absolute") continue;
    if (el.hasAttribute("data-fit-skip") || el.hasAttribute("data-fit-chip")) continue;
    items++;
    if (el !== name) other += el.getBoundingClientRect().width;
  }
  return {
    lineWidth: line.clientWidth,
    nameWidth: name.scrollWidth,
    otherWidth: other + Math.max(0, items - 1) * gap,
    chipWidth: chip.getBoundingClientRect().width + gap,
  };
}
