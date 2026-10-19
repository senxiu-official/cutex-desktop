// The panes of one tool column (the former cards of a page, §24), top → bottom, with the 8 px gaps between them as height handles
// (docs/desktop-modules.md §18.4): drag = resize the two cards, double-click = split evenly, arrows
// when focused. Heights come from lib/sideLayout cardHeights (collapsed / folded cards = header only).
// The gaps are also drop targets while a card / tab is dragged (data-side-gap = the card below).
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useI18n } from "../../i18n";
import type { SideRegistry } from "../../lib/sideComponents";
import { CARD_GAP, cardHeights, dragGap, equalizeCards, MIN_CARD_HEIGHT, setCardSizes, shownTab, visibleTabs, type SideCard, type SidePage, type SideViewContext } from "../../lib/sideLayout";
import { updateLayout, useSide } from "../../lib/sideLayoutStore";
import { SideCardView } from "./SideCard";

const KEY_STEP = 16;

export function SidePageView({ page, cards, registry, ctx, edge, currentWidth }: { page: SidePage; cards: readonly SideCard[]; registry: SideRegistry; ctx: SideViewContext; edge: boolean; currentWidth: () => number }) {
  const { t } = useI18n();
  const layout = useSide((s) => s.layout);
  const box = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setHeight(el.clientHeight);
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const single = cards.length === 1;
  const boxes = cardHeights(
    cards.map((c) => ({ size: c.size, collapsed: c.collapsed && !single, minHeight: registry.get(c.kind)?.item.minHeight })),
    height,
  );

  // Gap k sits above card k. Drag between the nearest expanded cards above and below it.
  const drag = useRef<{ y: number; sizes: number[]; a: number; b: number; px: number; total: number } | null>(null);
  const open = cards.map((_, k) => k).filter((k) => !boxes[k]?.folded);
  const pair = (k: number): [number, number] | null => {
    const a = [...open].reverse().find((i) => i < k);
    const b = open.find((i) => i >= k);
    return a === undefined || b === undefined ? null : [a, b];
  };
  const apply = (a: number, b: number, sizes: number[], total: number) => {
    const map: Record<string, number> = {};
    map[cards[a]!.id] = sizes[a]! * total;
    map[cards[b]!.id] = sizes[b]! * total;
    updateLayout((l) => setCardSizes(l, page.id, map));
  };
  const start = (k: number) => (e: PointerEvent<HTMLDivElement>) => {
    const p = pair(k);
    if (!p || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.setAttribute("data-dragging", "");
    const total = open.reduce((s, i) => s + cards[i]!.size, 0) || 1;
    const px = open.reduce((s, i) => s + (boxes[i]?.height ?? 0), 0);
    drag.current = { y: e.clientY, sizes: cards.map((c) => c.size / total), a: p[0], b: p[1], px, total };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const min = Math.max(MIN_CARD_HEIGHT, registry.get(cards[d.a]!.kind)?.item.minHeight ?? 0, registry.get(cards[d.b]!.kind)?.item.minHeight ?? 0);
    const next = dragGap(d.sizes, d.a, d.b, e.clientY - d.y, d.px, d.px > 0 ? min / d.px : 0.1);
    apply(d.a, d.b, next, d.total);
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    e.currentTarget.removeAttribute("data-dragging");
  };
  const key = (k: number) => (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    const p = pair(k);
    if (!dir || !p) return;
    e.preventDefault();
    const total = open.reduce((s, i) => s + cards[i]!.size, 0) || 1;
    const px = open.reduce((s, i) => s + (boxes[i]?.height ?? 0), 0);
    const next = dragGap(cards.map((c) => c.size / total), p[0], p[1], dir * KEY_STEP, px, px > 0 ? MIN_CARD_HEIGHT / px : 0.1);
    apply(p[0], p[1], next, total);
  };

  return (
    <div ref={box} className="flex min-h-0 flex-1 flex-col">
      {cards.map((card, k) => {
        // A full column's bottom pane may hold another kind's tab (§24): the shown tab's kind draws the header.
        const shown = shownTab(layout, card, ctx);
        const entry = registry.get((shown && layout.instances[shown]?.kind) || card.kind) ?? registry.get(card.kind);
        if (!entry) return null;
        const b = boxes[k];
        const resizable = k > 0 && !!pair(k) && !b?.folded && !boxes[k - 1]?.folded;
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
                  style={{ height: CARD_GAP }}
                  onPointerDown={start(k)}
                  onPointerMove={move}
                  onPointerUp={end}
                  onLostPointerCapture={end}
                  onDoubleClick={() => updateLayout((l) => equalizeCards(l, page.id))}
                  onKeyDown={key(k)}
                />
              ) : (
                <div className="shrink-0" data-side-gap={card.id} data-side-gap-page={page.id} style={{ height: CARD_GAP }} />
              ))}
            <SideCardView
              page={page}
              card={card}
              entry={entry}
              tabs={visibleTabs(layout, card, ctx)}
              shown={shown}
              height={single || !height ? null : Math.max(0, Math.floor(b?.height ?? 0))}
              folded={!single && !!b?.folded}
              single={single}
              edge={edge}
              currentWidth={currentWidth}
            />
          </div>
        );
      })}
    </div>
  );
}
