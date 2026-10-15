// The gutters beside the reading column (docs/desktop-modules.md §19.2–§19.4; RFC §7.2–§7.5): a layer
// over the conversation card (pointer events only on what it draws) that measures the card, computes
// the geometry (lib/gutterLayout.ts) and draws, per side, the `conversation.gutter` triggers at the
// input's height (stacking upward) or fixed top corner, their popovers or docked lists, and on the left
// the reference card. Narrow gutters move only composer-level triggers into ComposerTriggers. Everything
// hides while the right side is maximised / full screen (the conversation is covered).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { useI18n } from "../../i18n";
import { useAppearance } from "../../lib/appearance";
import { COLUMN_PADDING, freeSpan, gutterLayout, gutterTriggerLocation, placeBelow, popoverWidth, type CardRect, type GutterGeometry } from "../../lib/gutterLayout";
import { clampDockPref, DOCK_WIDTH_DEFAULT, DOCK_WIDTH_RANGE, DOCK_WIDTH_STEP, dockWidth, dragDockWidth } from "../../lib/gutterDock";
import { useGutterItems, type GutterEntry } from "../../lib/gutterItems";
import { setGutterGeometry, setGutterPopover, setGutterTopStackBottom, toggleFolded, useGutter } from "../../lib/gutterStore";
import { setUiPref, useUiPrefs } from "../../lib/prefs";
import { useSide } from "../../lib/sideLayoutStore";
import { ItemBoundary } from "../../modules/Outlet";
import { GutterPopover } from "./GutterPopover";
import { GutterTrigger } from "./GutterTrigger";
import { PeekHost } from "./PeekCard";

type Rect = CardRect;

/** What the layer measured (px, relative to the conversation card). */
export interface GutterBox {
  cardWidth: number;
  width: number;
  height: number;
  /** The scroller's bottom edge (the composer area starts below it). */
  scrollerBottom: number;
  /** The composer's input box / the interaction dock / the archived banner as drawn; null when none is shown. */
  anchor: (Rect & { kind: string }) | null;
  /** The boxes `conversation.overlay` items draw (the status capsule as it is now): gutter content keeps clear of them. */
  overlays: readonly Rect[];
}

const sameRects = (a: readonly Rect[], b: readonly Rect[]) => a.length === b.length && a.every((r, i) => { const o = b[i]!; return r.left === o.left && r.top === o.top && r.right === o.right && r.bottom === o.bottom; });

const sameBox = (a: GutterBox | null, b: GutterBox) =>
  !!a && sameRects(a.overlays, b.overlays) && a.cardWidth === b.cardWidth && a.width === b.width && a.height === b.height && a.scrollerBottom === b.scrollerBottom && (a.anchor === b.anchor || (!!a.anchor && !!b.anchor && a.anchor.kind === b.anchor.kind && a.anchor.left === b.anchor.left && a.anchor.top === b.anchor.top && a.anchor.right === b.anchor.right && a.anchor.bottom === b.anchor.bottom));

/** The anchor's visual box: a column wrapper (`side-col`, the dock / banner) without its padding; the composer's input box as drawn. */
function anchorBox(el: HTMLElement, origin: DOMRect): Rect {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const px = (v: string) => (el.classList.contains("side-col") ? parseFloat(v) || 0 : 0);
  return {
    left: Math.round(r.left - origin.left + px(cs.paddingLeft)),
    top: Math.round(r.top - origin.top + px(cs.paddingTop)),
    right: Math.round(r.right - origin.left - px(cs.paddingRight)),
    bottom: Math.round(r.bottom - origin.top - px(cs.paddingBottom)),
  };
}

/**
 * What the overlays draw inside `[data-overlay-root]`: an overlay spans the conversation with a
 * pointer-transparent frame and draws its interactive box(es) in it, so the boxes are the outermost
 * elements that take pointer events (hidden / empty ones skipped). Generic: no overlay is named.
 */
function overlayElements(root: Element | null): HTMLElement[] {
  const out: HTMLElement[] = [];
  const visit = (el: Element) => {
    for (const child of el.children) {
      if (!(child instanceof HTMLElement)) continue;
      const cs = getComputedStyle(child);
      // A `display: contents` wrapper (one per overlay item) draws nothing itself.
      if (cs.display === "contents" || cs.pointerEvents === "none") visit(child);
      else out.push(child);
    }
  };
  if (root) visit(root);
  return out;
}

function overlayRects(root: Element | null, origin: DOMRect): Rect[] {
  const out: Rect[] = [];
  for (const el of overlayElements(root)) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    out.push({ left: Math.floor(r.left - origin.left), top: Math.floor(r.top - origin.top), right: Math.ceil(r.right - origin.left), bottom: Math.ceil(r.bottom - origin.top) });
  }
  return out;
}

/** One side's top / composer-level triggers + its open popover / docked lists. */
function GutterSide({ side, items, geometry, box, hostId, sessionId, layer, onStackTop }: { side: "left" | "right"; items: GutterEntry[]; geometry: GutterGeometry; box: GutterBox; hostId: string; sessionId: string; layer: HTMLDivElement | null; onStackTop(side: "left" | "right", top: number | null): void }) {
  const g = geometry[side];
  const popover = useGutter((s) => s.popover);
  const folded = useGutter((s) => s.folded);
  const { gutterDocked } = useUiPrefs();
  const triggers = useRef(new Map<string, HTMLDivElement>());
  const stack = useRef<HTMLDivElement>(null);
  const topStack = useRef<HTMLDivElement>(null);
  const topItems = items.filter((e) => gutterTriggerLocation(e.item.anchor, g) === "top" && (e.item.Body || e.item.Trigger));
  const composerItems = items.filter((e) => e.item.anchor !== "top");
  const inGutter = g.trigger === "gutter";
  // Narrow gutter but no composer on screen (archived {{agent}}): a row at the card's bottom corner.
  const bottomRow = !inGutter && !!box.anchor && box.anchor.kind !== "composer";
  useLayoutEffect(() => {
    const el = stack.current;
    onStackTop(side, el && inGutter && layer ? Math.round(el.getBoundingClientRect().top - layer.getBoundingClientRect().top) : null);
  });
  // The top entries sit at the corner, or below an overlay box (the capsule) they would intersect.
  const [topSize, setTopSize] = useState<{ width: number; height: number } | null>(null);
  const topX0 = side === "left" ? 8 : box.width - 8 - (topSize?.width ?? 0);
  const topY = topSize ? placeBelow(topX0, topX0 + topSize.width, g.topInset + 8, topSize.height, box.overlays) : g.topInset + 8;
  useLayoutEffect(() => {
    const el = topStack.current;
    if (!el || !layer) {
      setGutterTopStackBottom(side, null);
      setTopSize(null);
      return;
    }
    const measure = () => {
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      setTopSize((old) => (old && old.width === width && old.height === height ? old : { width, height }));
      setGutterTopStackBottom(side, Math.ceil(el.getBoundingClientRect().bottom - layer.getBoundingClientRect().top));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => { observer.disconnect(); setGutterTopStackBottom(side, null); };
  }, [items, box.width, topY, layer, side]);
  if (!items.length) return null;
  const dockable = (e: GutterEntry) => !!e.item.Body && !!e.item.dockMinWidth && gutterDocked.includes(e.item.id) && g.width >= e.item.dockMinWidth;
  const docked = items.filter((e) => dockable(e) && !folded.includes(e.item.id));
  // Triggers beside the anchor (8 px gap); without one, at the column's padding near the bottom.
  const a = box.anchor;
  const pos = a
    ? side === "left"
      ? { right: box.width - (a.left - 8), bottom: box.height - a.bottom }
      : { left: a.right + 8, bottom: box.height - a.bottom }
    : side === "left"
      ? { right: box.width - (geometry.columnLeft + COLUMN_PADDING - 8), bottom: 12 }
      : { left: geometry.columnLeft + geometry.columnWidth - COLUMN_PADDING + 8, bottom: 12 };
  const toggle = (e: GutterEntry) => () => {
    if (dockable(e)) return toggleFolded(e.item.id);
    setGutterPopover(popover === e.item.id ? null : e.item.id, triggers.current.get(e.item.id) ?? null);
  };
  const open = items.find((e) => e.item.id === popover && !dockable(e));
  const openAnchor = open ? triggers.current.get(open.item.id) : undefined;
  const card = layer?.getBoundingClientRect();
  const renderTrigger = (e: GutterEntry, where: "gutter" | "composer") => (
    <GutterTrigger
      key={e.item.id}
      ref={(el) => void (el ? triggers.current.set(e.item.id, el) : triggers.current.delete(e.item.id))}
      entry={e}
      hostId={hostId}
      sessionId={sessionId}
      where={where}
      docked={dockable(e)}
      folded={folded.includes(e.item.id)}
      open={dockable(e) ? !folded.includes(e.item.id) : popover === e.item.id}
      toggle={toggle(e)}
    />
  );
  return (
    <>
      {topItems.length > 0 && (
        <div
          ref={topStack}
          data-gutter-root
          data-gutter-top={side}
          className={`pointer-events-none absolute z-[6] flex max-w-[calc(50%-16px)] flex-wrap gap-1.5 rounded-lg border border-card-border bg-background shadow-sm ${side === "left" ? "left-2" : "right-2 justify-end"}`}
          style={{ top: topY }}
        >
          {topItems.map((e) => renderTrigger(e, "gutter"))}
        </div>
      )}
      {composerItems.length > 0 && (inGutter || bottomRow) && (
        <div
          ref={stack}
          className={`pointer-events-none absolute z-[6] flex ${bottomRow ? "bottom-1.5 gap-0.5" : "flex-col-reverse gap-1.5"} ${side === "left" ? "items-end" : "items-start"}`}
          style={bottomRow ? (side === "left" ? { left: 8 } : { right: 8 }) : pos}
        >
          {composerItems.map((e) => renderTrigger(e, bottomRow ? "composer" : "gutter"))}
        </div>
      )}
      {open && openAnchor && card && (
        <GutterPopover
          entry={open}
          hostId={hostId}
          sessionId={sessionId}
          side={side}
          anchor={openAnchor}
          edge={side === "left" ? card.left + 8 : window.innerWidth - card.right + 8}
          top={card.top + g.topInset + 8}
          width={popoverWidth(g.width)}
          direction={open.item.anchor === "top" ? "down" : "up"}
          close={() => setGutterPopover(null)}
        />
      )}
      {docked.length > 0 && <DockedLists side={side} entries={docked} geometry={geometry} box={box} hostId={hostId} sessionId={sessionId} />}
    </>
  );
}

/** The docked lists' inner-edge handle: drag live, stored (device-local pref) on release; double-click = default; arrows when focused. */
function DockHandle({ side, width, available, setLive }: { side: "left" | "right"; width: number; available: number; setLive(width: number | null): void }) {
  const { t } = useI18n();
  const drag = useRef<{ x: number; width: number; last: number } | null>(null);
  const end = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    e.currentTarget.removeAttribute("data-dragging");
    setUiPref("gutterDockWidth", d.last);
    setLive(null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const grow = side === "left" ? "ArrowRight" : "ArrowLeft";
    const shrink = side === "left" ? "ArrowLeft" : "ArrowRight";
    if (e.key !== grow && e.key !== shrink) return;
    e.preventDefault();
    setUiPref("gutterDockWidth", clampDockPref(width + (e.key === grow ? DOCK_WIDTH_STEP : -DOCK_WIDTH_STEP)));
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("gutter.resizeHint")}
      aria-valuemin={DOCK_WIDTH_RANGE[0]}
      aria-valuemax={Math.min(DOCK_WIDTH_RANGE[1], Math.floor(available))}
      aria-valuenow={width}
      tabIndex={0}
      title={t("gutter.resizeHint")}
      data-gutter-dock-handle={side}
      className={`side-handle-v absolute top-3 bottom-3 z-10 w-[7px] cursor-col-resize outline-none ${side === "left" ? "-right-[5px]" : "-left-[5px]"}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.setAttribute("data-dragging", "");
        drag.current = { x: e.clientX, width, last: width };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        d.last = dockWidth(dragDockWidth(side, d.width, e.clientX - d.x), available);
        setLive(d.last);
      }}
      onPointerUp={end}
      onLostPointerCapture={end}
      onDoubleClick={() => setUiPref("gutterDockWidth", DOCK_WIDTH_DEFAULT)}
      onKeyDown={onKeyDown}
    />
  );
}

/** Docked lists: from the top (below a capsule) down to above the triggers, at the pref width (lib/gutterDock). The reference card covers them. */
function DockedLists({ side, entries, geometry, box, hostId, sessionId }: { side: "left" | "right"; entries: GutterEntry[]; geometry: GutterGeometry; box: GutterBox; hostId: string; sessionId: string }) {
  const { t } = useI18n();
  const g = geometry[side];
  const stackTop = useGutter((s) => (side === "left" ? s.stackTop.left : s.stackTop.right));
  const topStackBottom = useGutter((s) => s.topStackBottom[side]);
  const { gutterDockWidth } = useUiPrefs();
  const [live, setLive] = useState<number | null>(null);
  // The gutter's room (the old full width); the list draws at the pref width within it.
  const available = Math.max(0, g.width + COLUMN_PADDING - 16);
  const width = dockWidth(live ?? gutterDockWidth, available);
  const x0 = side === "left" ? 8 : box.width - 8 - width;
  const { top, bottom: bottomLimit } = freeSpan(
    x0,
    x0 + width,
    Math.max(g.topInset + 8, (topStackBottom ?? 0) + 8),
    Math.min(stackTop ?? box.anchor?.top ?? box.height, g.bottomBand ? box.scrollerBottom - g.bottomBand : Number.POSITIVE_INFINITY) - 8,
    box.overlays,
  );
  if (bottomLimit - top < 80) return null;
  return (
    <div
      data-gutter-root
      data-focus-region={`gutter-${side}`}
      aria-label={t(side === "left" ? "gutter.left" : "gutter.right")}
      className={`pointer-events-auto absolute z-[5] flex flex-col gap-2 ${side === "left" ? "left-2" : "right-2"}`}
      style={{ top, height: bottomLimit - top, width }}
    >
      <DockHandle side={side} width={width} available={available} setLive={setLive} />
      {entries.map((e) => {
        const Body = e.item.Body!;
        return (
          <div key={e.item.id} data-gutter-docked={e.item.id} className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-card-border bg-background shadow-sm">
            <div className="min-h-0 flex-1 overflow-y-auto p-1 text-sm">
              <ItemBoundary moduleId={e.moduleId} resetKey={sessionId}>
                <Body hostId={hostId} sessionId={sessionId} width={width} docked close={() => toggleFolded(e.item.id)} />
              </ItemBoundary>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** `corner`: an overlay at a window-edge corner beside the column (the status capsule), from the conversation's reservations. */
export function GutterHost({ sessionId, hostId, scroller, corner }: { sessionId: string; hostId: string; scroller: RefObject<HTMLDivElement | null>; corner: { side: "left" | "right"; anchor: "top" | "bottom" } | null }) {
  const layer = useRef<HTMLDivElement>(null);
  const { readingWidth } = useAppearance();
  const sideShift = useGutter((s) => s.sideShift);
  const sideCover = useGutter((s) => s.sideCover);
  const covered = useSide((s) => !!s.mode);
  const items = useGutterItems(sessionId, hostId);
  const [box, setBox] = useState<GutterBox | null>(null);

  const measure = useCallback(() => {
    const el = layer.current;
    const sc = scroller.current;
    const main = el?.parentElement;
    if (!el || !sc || !main) return;
    // A maximised / full-screen side covers the conversation: nothing to measure. A box kept from
    // then would be the first geometry after the mode ends, and the reference card (hidden meanwhile)
    // would read it as "too narrow" and move to the right side instead of coming back.
    if (useSide.getState().mode) {
      setBox(null);
      return;
    }
    const origin = main.getBoundingClientRect();
    const anchorEl = [...main.querySelectorAll<HTMLElement>("[data-gutter-anchor]")].find((a) => a.getBoundingClientRect().height > 0);
    const next: GutterBox = {
      cardWidth: sc.clientWidth,
      width: Math.round(origin.width),
      height: Math.round(origin.height),
      scrollerBottom: Math.round(sc.getBoundingClientRect().bottom - origin.top),
      anchor: anchorEl ? { ...anchorBox(anchorEl, origin), kind: anchorEl.dataset.gutterAnchor ?? "" } : null,
      overlays: overlayRects(main.querySelector("[data-overlay-root]"), origin),
    };
    setBox((old) => (sameBox(old, next) ? old : next));
  }, [scroller]);

  // Re-measure when the card or any part of its bottom stack (composer, dock, banner) changes size, or
  // when those come and go.
  useLayoutEffect(() => {
    const main = layer.current?.parentElement;
    if (!main) return;
    measure();
    const ro = new ResizeObserver(measure);
    const observeChildren = () => {
      ro.disconnect();
      ro.observe(main);
      if (scroller.current) ro.observe(scroller.current);
      for (const child of main.children) if (child !== layer.current) ro.observe(child);
      for (const a of main.querySelectorAll("[data-gutter-anchor]")) ro.observe(a);
      for (const o of overlayElements(main.querySelector("[data-overlay-root]"))) ro.observe(o);
    };
    observeChildren();
    const mo = new MutationObserver(() => {
      observeChildren();
      measure();
    });
    // The overlays' boxes come, go and change shape (a capsule collapsed / expanded, items added):
    // re-observe and re-measure once per frame.
    let frame = 0;
    const overlayRoot = main.querySelector("[data-overlay-root]");
    const omo = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        observeChildren();
        measure();
      });
    });
    if (overlayRoot) omo.observe(overlayRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
    mo.observe(main, { childList: true });
    for (const child of main.children) if (child !== layer.current && !child.contains(scroller.current)) mo.observe(child, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      mo.disconnect();
      omo.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, [measure, scroller, sessionId]);
  useLayoutEffect(() => measure(), [measure, readingWidth, sideShift, sideCover, covered]);

  const geometry = box
    ? gutterLayout({ cardWidth: box.cardWidth, shift: sideShift, sideCover, readingWidth, columnPadding: COLUMN_PADDING, capsule: corner, conversationVisible: !covered })
    : null;
  useEffect(() => setGutterGeometry(geometry, box?.cardWidth ?? 0));
  useEffect(() => () => setGutterGeometry(null, 0), []);
  // A popover of an item that went away (module off, agent switch) closes.
  const popover = useGutter((s) => s.popover);
  useEffect(() => {
    if (popover && ![...items.left, ...items.right].some((e) => e.item.id === popover)) setGutterPopover(null);
  }, [popover, items]);
  useEffect(() => () => setGutterPopover(null), [sessionId]);
  const onStackTop = useCallback((side: "left" | "right", top: number | null) => {
    const current = useGutter.getState().stackTop;
    if (current[side] !== top) useGutter.setState({ stackTop: { ...current, [side]: top } });
  }, []);

  return (
    <div ref={layer} data-gutter-layer className="pointer-events-none absolute inset-0 z-[5]" aria-hidden={covered || undefined}>
      {geometry && box && !covered && (
        <>
          <GutterSide side="left" items={items.left} geometry={geometry} box={box} hostId={hostId} sessionId={sessionId} layer={layer.current} onStackTop={onStackTop} />
          <GutterSide side="right" items={items.right} geometry={geometry} box={box} hostId={hostId} sessionId={sessionId} layer={layer.current} onStackTop={onStackTop} />
          <PeekHost geometry={geometry} box={box} />
        </>
      )}
    </div>
  );
}
