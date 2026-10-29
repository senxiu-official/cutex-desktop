// The panes of a Shelf's page (the former cards, §24 / §24.12), top → bottom, with the 8 px gaps between them as height handles
// (docs/desktop-modules.md §18.4): drag = resize the two cards, double-click = split evenly, arrows
// when focused. Heights come from lib/sideLayout cardHeights (collapsed / folded cards = header only; a pane folds for
// lack of room only when the open panes' min heights do not fit, else a short share is drawn at its min). A gap beside a
// folded pane (collapsed, or folded for lack of room) stays a handle: pulling it away from that pane opens it
// (lib/sideLayout unfoldSizes), double-click opens it at an even split with its neighbour; the pane's ▾ and a
// double-click on its title bar open it too. Only panes folded by another pane's 最大化 stay a view.
// The gaps are also drop targets while a card / tab is dragged (data-side-gap = the card below).
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useI18n } from "../../i18n";
import type { SideRegistry } from "../../lib/sideComponents";
import { cardHeights, dragGap, equalizeCards, MIN_CARD_HEIGHT, setCardSizes, setCollapsed, SHELF_PANE_GAP, shownTab, unfoldSizes, visibleTabs, type SideCard, type SidePage, type SideViewContext } from "../../lib/sideLayout";
import { updateLayout } from "../../lib/sideLayoutStore";
import { useShelfLayout } from "../../lib/shelfSource";
import type { WidthTarget } from "../../lib/sideResize";
import { SideCardView } from "./SideCard";
import { EmptySlot } from "./EmptySlot";
import { foldedForGrow, useGrow } from "../../lib/panelGrow";
import { sharedResizeObserver } from "../../lib/resizeHub";

const KEY_STEP = 16;
/** A pull of a folded pane's gap shorter than this does nothing (a click on the gap is not an open). */
const UNFOLD_PULL = 6;

export function SidePageView({ page, cards, registry, ctx, edge, currentWidth, target }: { page: SidePage; cards: readonly SideCard[]; registry: SideRegistry; ctx: SideViewContext; edge: "left" | "right" | null; currentWidth: () => number; target: WidthTarget | null }) {
  const { t } = useI18n();
  const layout = useShelfLayout();
  const box = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setHeight(el.clientHeight);
    const ro = sharedResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const single = cards.length === 1;
  // 最大化 of a pane (rule 2, lib/panelGrow): it fills its page, the others show as their title bars (a view only).
  const grownCard = useGrow((s) => (s.target?.kind === "shelf" ? s.target.card : null));
  const growFold = foldedForGrow(
    cards.map((c) => c.id),
    grownCard,
  );
  const boxes = cardHeights(
    cards.map((c, k) => ({ size: c.size, collapsed: (c.collapsed || !!growFold[k]) && !single, minHeight: registry.get(c.kind)?.item.minHeight })),
    height,
    SHELF_PANE_GAP,
  );

  // Gap k sits above card k. Drag between the nearest expanded cards above and below it.
  const drag = useRef<{ y: number; sizes: number[]; a: number; b: number; px: number; total: number; unfold?: { f: number; donor: number; dir: 1 | -1 } } | null>(null);
  const open = cards.map((_, k) => k).filter((k) => !boxes[k]?.folded);
  const minOf = (i: number) => Math.max(MIN_CARD_HEIGHT, registry.get(cards[i]!.kind)?.item.minHeight ?? 0);
  // A folded pane next to gap k (the one below first) and the open pane on the gap's other side that gives it room.
  const unfoldAt = (k: number): { f: number; donor: number; dir: 1 | -1 } | null => {
    if (growFold.some(Boolean) || single) return null;
    if (boxes[k]?.folded) {
      const donor = [...open].reverse().find((i) => i < k);
      return donor === undefined ? null : { f: k, donor, dir: -1 };
    }
    if (boxes[k - 1]?.folded) {
      const donor = open.find((i) => i >= k);
      return donor === undefined ? null : { f: k - 1, donor, dir: 1 };
    }
    return null;
  };
  // Open folded pane f at `want` px from `donor`; null: no room (the page is too short for both minimums).
  const unfold = (f: number, donor: number, want: number): number[] | null => {
    const sizes = unfoldSizes(cards, boxes, f, donor, want, { f: minOf(f), donor: minOf(donor) });
    if (!sizes) return null;
    const map: Record<string, number> = {};
    for (const i of [...open, f]) map[cards[i]!.id] = sizes[i]!;
    updateLayout((l) => setCardSizes(setCollapsed(l, cards[f]!.id, false), page.id, map));
    return sizes;
  };
  /** The ▾ / title-bar double-click of folded pane f: back at its own share if there is room (else as much as fits). */
  const restore = (f: number) => {
    const donor = [...open].reverse().find((i) => i < f) ?? open.find((i) => i > f);
    const sum = open.reduce((s, i) => s + Math.max(cards[i]!.size, 0.0001), 0);
    const px = open.reduce((s, i) => s + (boxes[i]?.height ?? 0), 0);
    // Its share of the page with it open again (the room its title bar has now included).
    const own = (Math.max(cards[f]!.size, 0.0001) * (px + (boxes[f]?.height ?? 0))) / (sum + Math.max(cards[f]!.size, 0.0001));
    if (donor !== undefined && unfold(f, donor, own)) return;
    updateLayout((l) => setCollapsed(l, cards[f]!.id, false));
  };
  const pair = (k: number): [number, number] | null => {
    const a = [...open].reverse().find((i) => i < k);
    const b = open.find((i) => i >= k);
    return a === undefined || b === undefined ? null : [a, b];
  };
  // The open panes' shares as drawn (of their stored total): a pane cardHeights holds at its min is drawn taller than
  // its share — a drag / key works from what is drawn, so the gap moves with the pointer at once.
  const drawn = () => {
    const total = open.reduce((s, i) => s + cards[i]!.size, 0) || 1;
    const px = open.reduce((s, i) => s + (boxes[i]?.height ?? 0), 0);
    const sizes = cards.map((c, i) => (px > 0 && open.includes(i) ? (boxes[i]?.height ?? 0) / px : c.size / total));
    return { sizes, total, px };
  };
  // Writes every open pane (the pair changed; the others as drawn).
  const apply = (sizes: number[], total: number) => {
    const map: Record<string, number> = {};
    for (const i of open) map[cards[i]!.id] = sizes[i]! * total;
    updateLayout((l) => setCardSizes(l, page.id, map));
  };
  const start = (k: number) => (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const u = unfoldAt(k);
    if (u) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.setAttribute("data-dragging", "");
      drag.current = { y: e.clientY, sizes: [], a: -1, b: -1, px: 0, total: 0, unfold: u };
      return;
    }
    const p = pair(k);
    if (!p) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.setAttribute("data-dragging", "");
    const { sizes, total, px } = drawn();
    drag.current = { y: e.clientY, sizes, a: p[0], b: p[1], px, total };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (d.unfold) {
      // Pulled away from the folded pane: it opens (at least at its min height) and the drag goes on as a resize.
      const { f, donor, dir } = d.unfold;
      const pulled = (e.clientY - d.y) * dir;
      if (pulled < UNFOLD_PULL) return;
      const sizes = unfold(f, donor, (boxes[f]?.height ?? 0) + pulled);
      if (!sizes) return;
      const openNow = [...open, f];
      const total = openNow.reduce((s, i) => s + sizes[i]!, 0) || 1;
      const px = open.reduce((s, i) => s + (boxes[i]?.height ?? 0), 0) + (boxes[f]?.height ?? 0);
      // From where the gap is now (it may have jumped to f's min height), so it meets the pointer and then follows it.
      const opened = (sizes[f]! / total) * px - (boxes[f]?.height ?? 0);
      drag.current = { y: d.y + dir * opened, sizes: sizes.map((x) => x / total), a: Math.min(f, donor), b: Math.max(f, donor), px, total };
      return;
    }
    const min = Math.max(MIN_CARD_HEIGHT, registry.get(cards[d.a]!.kind)?.item.minHeight ?? 0, registry.get(cards[d.b]!.kind)?.item.minHeight ?? 0);
    const next = dragGap(d.sizes, d.a, d.b, e.clientY - d.y, d.px, d.px > 0 ? min / d.px : 0.1);
    apply(next, d.total);
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    e.currentTarget.removeAttribute("data-dragging");
  };
  const key = (k: number) => (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    const u = unfoldAt(k);
    if (u) {
      if (dir !== u.dir) return;
      e.preventDefault();
      unfold(u.f, u.donor, (boxes[u.f]?.height ?? 0) + KEY_STEP);
      return;
    }
    const p = pair(k);
    if (!dir || !p) return;
    e.preventDefault();
    const { sizes, total, px } = drawn();
    const next = dragGap(sizes, p[0], p[1], dir * KEY_STEP, px, px > 0 ? MIN_CARD_HEIGHT / px : 0.1);
    apply(next, total);
  };

  return (
    <div ref={box} className="flex min-h-0 flex-1 flex-col">
      {cards.map((card, k) => {
        // A full column's bottom pane may hold another kind's tab (§24): the shown tab's kind draws the header.
        const shown = shownTab(layout, card, ctx);
        const entry = registry.get((shown && layout.instances[shown]?.kind) || card.kind) ?? registry.get(card.kind);
        if (!entry) return null;
        const b = boxes[k];
        const u = k > 0 ? unfoldAt(k) : null;
        const resizable = k > 0 && (!!u || (!!pair(k) && !b?.folded && !boxes[k - 1]?.folded));
        const tabs = visibleTabs(layout, card, ctx);
        const h = single || !height ? null : Math.max(0, Math.floor(b?.height ?? 0));
        return (
          <div key={card.id} className="contents">
            {k > 0 &&
              (resizable ? (
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  data-side-gap={card.id}
                  data-side-gap-page={page.id}
                  tabIndex={0}
                  title={t("side.heightHint")}
                  className="side-handle-h relative shrink-0 cursor-row-resize outline-none"
                  style={{ height: SHELF_PANE_GAP }}
                  onPointerDown={start(k)}
                  onPointerMove={move}
                  onPointerUp={end}
                  onLostPointerCapture={end}
                  data-side-gap-unfold={u ? cards[u.f]!.id : undefined}
                  onDoubleClick={() => {
                    if (!u) return updateLayout((l) => equalizeCards(l, page.id));
                    unfold(u.f, u.donor, ((boxes[u.donor]?.height ?? 0) + (boxes[u.f]?.height ?? 0)) / 2);
                  }}
                  onKeyDown={key(k)}
                />
              ) : (
                <div className="shrink-0" data-side-gap={card.id} data-side-gap-page={page.id} style={{ height: SHELF_PANE_GAP }} />
              ))}
            {/* Nothing in it for this agent (a page that keeps its layout, lib/sideLayout shownCards): an empty slot. */}
            {!tabs.length ? (
              <EmptySlot page={page} card={card} entry={registry.get(card.kind) ?? entry} ctx={ctx} height={h} folded={h !== null && !!b?.folded} onRestore={h !== null && b?.folded && !growFold[k] ? () => restore(k) : undefined} />
            ) : (
            <SideCardView
              page={page}
              card={card}
              entry={entry}
              tabs={tabs}
              shown={shown}
              height={h}
              folded={!single && !!b?.folded}
              onRestore={!single && b?.folded && !growFold[k] ? () => restore(k) : undefined}
              single={single}
              edge={edge}
              currentWidth={currentWidth}
              target={target}
            />
            )}
          </div>
        );
      })}
    </div>
  );
}
