import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useOwnerWindow } from "../lib/ownerContext";

interface Item {
  key: string;
  kind: "group" | "row";
  render(): ReactNode;
}

/** Native row groups retain table column sizing and include any expanded detail rows in measurement. */
export function VirtualTableBody({ items, columnCount }: { items: Item[]; columnCount: number }) {
  const win = useOwnerWindow();
  const marker = useRef<HTMLTableSectionElement>(null);
  const nodes = useRef(new Map<string, HTMLTableSectionElement>());
  const heights = useRef(new Map<string, number>());
  const measuredWidth = useRef<number | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 0, unavailable: false });
  const [focused, setFocused] = useState<string | null>(null);
  const [, invalidate] = useState(0);

  useLayoutEffect(() => {
    const start = marker.current!;
    const table = start.closest("table")!;
    const keys = new Set(items.map((item) => item.key));
    for (const key of heights.current.keys()) if (!keys.has(key)) heights.current.delete(key);
    let scroller = table.parentElement;
    while (scroller && !/(auto|scroll|overlay)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const scrollTarget = scroller ?? window;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = table.getBoundingClientRect();
      const height = scroller ? scroller.clientHeight : win.innerHeight;
      // Zero geometry is the layout-free test environment (or a hidden page). Recheck on resize.
      const unavailable = rect.width === 0 && document.documentElement.clientWidth === 0;
      if (measuredWidth.current !== rect.width) {
        measuredWidth.current = rect.width;
        heights.current.clear();
      }
      let changed = false;
      for (const [key, node] of nodes.current) {
        const measured = node.getBoundingClientRect().height;
        if (measured > 0 && heights.current.get(key) !== measured) {
          heights.current.set(key, measured);
          changed = true;
        }
      }
      const top = (scroller ? scroller.getBoundingClientRect().top + scroller.clientTop : 0) - start.getBoundingClientRect().top;
      setViewport((old) => old.top === top && old.height === height && old.unavailable === unavailable ? old : { top, height, unavailable });
      if (changed) invalidate((n) => n + 1);
    };
    const schedule = () => { if (!frame) frame = win.requestAnimationFrame(update); };
    const observer = typeof ResizeObserver === "undefined" ? null : new win.ResizeObserver(schedule);
    observer?.observe(table);
    if (scroller) observer?.observe(scroller);
    for (const node of nodes.current.values()) observer?.observe(node);
    scrollTarget.addEventListener("scroll", schedule, { passive: true });
    win.addEventListener("resize", schedule);
    update();
    return () => {
      observer?.disconnect();
      scrollTarget.removeEventListener("scroll", schedule);
      win.removeEventListener("resize", schedule);
      if (frame) win.cancelAnimationFrame(frame);
    };
  });

  // Unknown heights use the measured mean for their kind; the first bounded sample bootstraps it.
  const sums = { group: 0, row: 0 };
  const counts = { group: 0, row: 0 };
  for (const item of items) {
    const measured = heights.current.get(item.key);
    if (measured) { sums[item.kind] += measured; counts[item.kind]++; }
  }
  const estimate = (item: Item) => heights.current.get(item.key) ?? (counts[item.kind] ? sums[item.kind] / counts[item.kind] : 36);
  const focusIndex = items.findIndex((item) => item.key === focused);
  const rowIndices = items.flatMap((item, index) => item.kind === "row" ? [index] : []);
  const focusedRow = rowIndices.indexOf(focusIndex);
  // Endpoints preserve entry from controls before/after the table, even when scrolled to its middle.
  const pinned = new Set([rowIndices[0], rowIndices.at(-1)]);
  if (focusedRow >= 0) {
    pinned.add(focusIndex);
    pinned.add(rowIndices[focusedRow - 1]);
    pinned.add(rowIndices[focusedRow + 1]);
  }
  let offset = 0;
  let gap = 0;
  const content: ReactNode[] = [];
  const spacer = (key: string) => {
    if (!gap) return;
    content.push(<tbody key={`gap:${key}`} aria-hidden="true"><tr><td colSpan={columnCount} style={{ height: gap, padding: 0, border: 0 }} /></tr></tbody>);
    gap = 0;
  };
  items.forEach((item, index) => {
    const height = estimate(item);
    const visible = viewport.unavailable || item.kind === "group" ||
      (viewport.height === 0 ? index < 12 : offset + height >= viewport.top - 300 && offset <= viewport.top + viewport.height + 300) ||
      pinned.has(index);
    if (visible) {
      spacer(item.key);
      content.push(
        <tbody key={item.key} data-virtual-item={item.key}
          ref={(node) => { if (node) nodes.current.set(item.key, node); else nodes.current.delete(item.key); }}
          onFocusCapture={() => {
            // Commit the next/previous row before the browser computes its next native Tab stop.
            if (focused !== item.key) flushSync(() => setFocused(item.key));
          }}
          onBlurCapture={(event) => {
            if (!event.currentTarget.closest("table")?.contains(event.relatedTarget as Node | null)) setFocused(null);
          }}
        >{item.render()}</tbody>,
      );
    } else gap += height;
    offset += height;
  });
  spacer("end");
  return <Fragment><tbody ref={marker} aria-hidden="true"><tr><td colSpan={columnCount} style={{ height: 0, padding: 0, border: 0 }} /></tr></tbody>{content}</Fragment>;
}
