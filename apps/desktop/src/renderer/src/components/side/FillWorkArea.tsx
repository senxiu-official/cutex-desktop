import { useLayoutEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from "react";
import { useI18n } from "../../i18n";
import { useAppearance } from "../../lib/appearance";
import { useStripPanes } from "../../lib/convStrips";
import { useShelfOnlyPanes } from "../../lib/shelfOnly";
import { onResizeDrag, resizeDrag, resizing } from "../../lib/columnGlide";
import { STRIP_W } from "../../lib/workspaceRow";
import { convKey } from "../../lib/convShelves";
import { fillColumnCount, fillWidths } from "../../lib/fillLayout";
import { DEFAULT_FILL_RATIOS, persistFillRatios, setFillRatios, useFillRatios } from "../../lib/fillStore";
import { conversationPanes, paneBinding } from "../../lib/paneLayout";
import { focusConversationPane, usePanes } from "../../lib/paneStore";
import { setPaneRoom } from "../../lib/paneRoom";
import { CARD_GAP, COLLAPSED_SHELF_WIDTH, columnsOnScreen, railsOnScreen, RAIL_WIDTH, setOpen, type ShelfOnScreen, type SideLayout, type SideViewContext } from "../../lib/sideLayout";
import { useSideRegistry, useSideView, type SideRegistry } from "../../lib/sideComponents";
import { liveConversation, setNarrow, syncPeers, updateLayout, useSide } from "../../lib/sideLayoutStore";
import { usePeerSource, usePeerViewContext } from "../../lib/shelfSource";
import { ShelfSourceContext } from "../../lib/shelfSourceContext";
import { setRowHooks } from "../../lib/sideResize";
import { registerSideAnchor, slotsRelayout } from "../../lib/sideSlots";
import { observeSync } from "../../lib/syncResize";
import { useInWindow, useWindowKey } from "../../lib/windowScope";
import { WsRowContext, type WsRowView } from "../../lib/workspaceRowView";
import { EmptyShelfRail } from "./ShelfRail";

type ShelfProps = { entry: ShelfOnScreen; registry: SideRegistry; ctx: SideViewContext; resizable: boolean; currentWidth: () => number; collapsed?: boolean; at?: "left" | "right" };
const CONV_MIN = 360, SHELF_MIN = 260 + RAIL_WIDTH + CARD_GAP;
function entries(layout: SideLayout, ctx: SideViewContext, always: boolean): ShelfOnScreen[] {
  if (!layout.open && !always) return [];
  const open = layout.open ? layout : { ...layout, open: true };
  return [...columnsOnScreen(open, ctx, null), ...railsOnScreen(open, ctx)].sort((a, b) => a.shelf.side === b.shelf.side ? 0 : a.shelf.side === "left" ? -1 : 1);
}

/** The existing conversations and Shelf views, with a separate, opt-in width allocation. */
export function FillWorkArea({ children, Shelf }: { children: ReactNode; Shelf: ComponentType<ShelfProps> }) {
  const { t } = useI18n();
  const appearance = useAppearance();
  const panes = usePanes(s => s.layout);
  const scope = usePanes(s => s.scope);
  const windowKey = useWindowKey();
  const inMine = useInWindow();
  const key = `${scope ?? "local"}/${windowKey}`;
  const ids = conversationPanes(panes);
  const bindings = ids.map(id => paneBinding(panes, id));
  const keys = bindings.map(b => b?.sessionId ? convKey(b.hostId, b.sessionId) : null);
  const live = useSide(s => s.layout);
  const baseCtx = useSideView();
  const registry = useSideRegistry();
  // A fixed hook set supports all three column positions, including a temporarily empty column.
  const p0 = usePeerSource(keys[0] === liveConversation() ? null : keys[0] ?? null);
  const p1 = usePeerSource(keys[1] === liveConversation() ? null : keys[1] ?? null);
  const p2 = usePeerSource(keys[2] === liveConversation() ? null : keys[2] ?? null);
  const c0 = usePeerViewContext(baseCtx, p0), c1 = usePeerViewContext(baseCtx, p1), c2 = usePeerViewContext(baseCtx, p2);
  const peers = [p0, p1, p2], contexts = [c0, c1, c2];
  const signature = keys.join("|");
  useLayoutEffect(() => { inMine(() => syncPeers()); }, [signature, inMine]);
  const saved = useFillRatios(s => s.scopes[key] ?? DEFAULT_FILL_RATIOS);
  const ratios = useMemo(() => fillColumnCount(saved, ids.length), [saved, ids.length]);
  useLayoutEffect(() => { if (saved !== ratios) setFillRatios(key, ratios); }, [key, saved, ratios]);
  const [element, attach] = useState<HTMLDivElement | null>(null);
  const [area, setArea] = useState(0);
  const adjustArea = useRef<(width: number, left: number) => void>(() => {});
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => { if (element.isConnected) { adjustArea.current(element.clientWidth, element.getBoundingClientRect().left); setArea(element.clientWidth); } };
    measure();
    const off = observeSync(element, measure), anchor = registerSideAnchor(element);
    return () => { off(); anchor(); };
  }, [element]);
  const stripped = useStripPanes();
  const onlyShelves = useShelfOnlyPanes();
  const columns = ids.map((id, index) => {
    const source = peers[index] ?? null;
    const layout = source?.layout ?? live;
    const ctx = contexts[index] ?? baseCtx;
    const strip = stripped.includes(id), onlyShelf = onlyShelves.includes(id);
    const list = !strip && bindings[index]?.sessionId ? entries(layout, ctx, appearance.shelfRailAlways) : [];
    const shelves = list.map(entry => ({ entry, expanded: layout.open && !entry.shelf.collapsed }));
    const empty = !strip && !list.length && appearance.shelfRailAlways && !!bindings[index]?.sessionId;
    return { id, source, ctx, shelves, empty, strip, onlyShelf };
  });
  const available = Math.max(0, area - Math.max(0, ids.length - 1) * CARD_GAP);
  const mins = columns.map(c => (c.strip || c.onlyShelf ? STRIP_W : CONV_MIN) + (c.empty ? COLLAPSED_SHELF_WIDTH : c.shelves.reduce((s, x) => s + (x.expanded ? SHELF_MIN : COLLAPSED_SHELF_WIDTH), 0)));
  // A Shelf only borrows from its own position; opening it never steals another column's width.
  const floors = columns.map(c => (c.strip || c.onlyShelf ? STRIP_W : CONV_MIN) + (c.shelves.length + Number(c.empty)) * COLLAPSED_SHELF_WIDTH);
  const active = columns.map((c,i) => c.strip ? -1 : i).filter(i => i >= 0);
  const activeWidths = fillWidths(Math.max(0, available - (columns.length-active.length)*STRIP_W), active.map(i=>ratios.columns[i]!), active.map(i=>floors[i]!));
  const budgets = columns.map((c,i) => c.strip ? STRIP_W : activeWidths[active.indexOf(i)]!);
  const shelfSignature = columns.map(c => c.shelves.map(s => `${s.entry.shelf.id}:${s.expanded}`).join(",")).join("|");
  // Column drags keep the current presentation until the window or the open panels change.
  const drawer = useMemo(() => area > 0 && mins.some((min, i) => min > budgets[i]! + .1), [area, signature, shelfSignature]); // eslint-disable-line react-hooks/exhaustive-deps
  const computed = columns.map((c, index) => {
    const budget = budgets[index] ?? 0;
    const fixed = (c.empty ? COLLAPSED_SHELF_WIDTH : 0) + c.shelves.filter(s => !s.expanded || drawer).length * COLLAPSED_SHELF_WIDTH;
    const expanded = c.shelves.filter(s => s.expanded && !drawer);
    const pref = ratios.shelves[index] ?? { left: .3, right: .4 };
    const shares = expanded.map(s => pref[s.entry.shelf.side]);
    const sum = shares.reduce((a, b) => a + b, 0);
    const widths = c.strip ? [STRIP_W] : c.onlyShelf && expanded.length ? [STRIP_W, ...fillWidths(Math.max(0, budget - fixed - STRIP_W), shares, expanded.map(() => SHELF_MIN))] : fillWidths(Math.max(0, budget - fixed), [Math.max(.05, 1 - sum), ...shares], [c.onlyShelf ? STRIP_W : CONV_MIN, ...expanded.map(() => SHELF_MIN)]);
    return { ...c, budget, conv: widths[0] ?? budget, shelves: c.shelves.map(s => ({ ...s, width: s.expanded && !drawer ? widths[expanded.indexOf(s) + 1]! : COLLAPSED_SHELF_WIDTH })) };
  });
  useLayoutEffect(() => { inMine(() => { setPaneRoom({ width: area, conversations: ids.length, tools: columns.some(c => c.shelves.length) ? 1 : 0 }); setNarrow(drawer); }); }, [area, ids.length, drawer, signature, inMine]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { slotsRelayout(); });
  useLayoutEffect(() => onResizeDrag(active => { if (!active) queueMicrotask(persistFillRatios); }), []);
  useLayoutEffect(() => () => { resizeDrag(false); persistFillRatios(); }, []);
  const view: WsRowView = { mode: "fill", fill: true, widths: computed.map(c => c.conv), railAt: computed.map(c => c.shelves.some(s => s.entry.shelf.side === "left") ? "left" : "right"), shelfBetween: true };
  const offsets = computed.map((_, i) => budgets.slice(0, i).reduce((a, b) => a + b, 0) + i * CARD_GAP);
  // Rebase displayed geometry: minimums may have constrained the saved ratios.
  // Only the panels touching the handle change; every other displayed width stays pinned.
  const saveGeometry = (next: typeof computed, room = available) => {
    const shelves = [...ratios.shelves];
    for (const [i, c] of next.entries()) {
      const fixed = (c.empty ? COLLAPSED_SHELF_WIDTH : 0) + c.shelves.filter(s => !s.expanded || drawer).length * COLLAPSED_SHELF_WIDTH;
      shelves[i] = { ...(shelves[i] ?? { left: .3, right: .4 }) };
      for (const s of c.shelves) if (s.expanded && !drawer) shelves[i]![s.entry.shelf.side] = s.width / Math.max(1, c.budget - fixed);
    }
    const foldedShare = next.reduce((sum, c, i) => sum + (c.strip ? ratios.columns[i]! : 0), 0);
    const activeRoom = room - next.filter(c => c.strip).length * STRIP_W;
    const columns = next.map((c, i) => c.strip ? ratios.columns[i]! : c.budget / Math.max(1, activeRoom) * (1 - foldedShare));
    setFillRatios(key, { ...ratios, columns, shelves }, false);
  };
  const resizeColumns = (index: number, width: number) => {
    const delta = width - computed[index]!.budget;
    const next = computed.map(c => ({ ...c, shelves: c.shelves.map(s => ({ ...s })) }));
    for (const [i, side, d] of [[index, "right", delta], [index + 1, "left", -delta]] as const) {
      const c = next[i]!;
      c.budget += d;
      const edge = c.shelves.find(s => s.expanded && !drawer && s.entry.shelf.side === side);
      if (edge) edge.width += d; else c.conv += d;
    }
    saveGeometry(next);
  };
  const resizeShelf = (index: number, side: "left" | "right", width: number) => {
    const next = computed.map(c => ({ ...c, shelves: c.shelves.map(s => ({ ...s })) }));
    const c = next[index]!, shelf = c.shelves.find(s => s.entry.shelf.side === side)!;
    c.conv -= width - shelf.width;
    shelf.width = width;
    saveGeometry(next);
  };
  const measured = useRef<{ width: number; left: number } | null>(null);
  adjustArea.current = (width, left) => {
    const before = measured.current;
    measured.current = { width, left };
    if (!before || !area || !resizing() || Math.abs(left - before.left) < .1 || Math.abs(width - before.width) < .1) return;
    const delta = width - before.width;
    const next = computed.map(c => ({ ...c, shelves: c.shelves.map(s => ({ ...s })) }));
    const first = next.find(c => !c.strip);
    if (!first) return;
    first.budget += delta;
    const edge = first.shelves.find(s => s.expanded && !drawer && s.entry.shelf.side === "left");
    if (edge) edge.width += delta; else first.conv += delta;
    saveGeometry(next, Math.max(0, width - Math.max(0, ids.length - 1) * CARD_GAP));
  };
  useLayoutEffect(() => {
    setRowHooks({
      shelfMax: () => null, shelfReset: () => {},
      give: side => {
        const c = side === "left" ? computed.find(c => !c.strip) : [...computed].reverse().find(c => !c.strip);
        if (!c) return 0;
        const edge = c.shelves.find(s => s.expanded && !drawer && s.entry.shelf.side === side);
        return Math.max(0, edge ? edge.width - SHELF_MIN : c.conv - CONV_MIN);
      }, gap: () => 0,
    });
    return () => setRowHooks(null);
  });
  return <WsRowContext.Provider value={view}>
    <div ref={attach} data-side-work="" data-fill-work="" data-ws-area={area} data-ws-width="fill" className="relative flex min-h-0 min-w-0 flex-1" style={{ "--reading-w": "768px" } as CSSProperties}>
      {children}
      {computed.map((c, index) => <ShelfSourceContext.Provider key={c.id} value={c.source}>
        {drawer && c.id === panes.focus && c.shelves.some(s => s.expanded) && <div data-drawer-scrim="" aria-hidden className="absolute inset-y-0 z-20 cursor-pointer bg-black/35" style={{ left: offsets[index], width: c.budget }} onPointerDown={() => inMine(() => { focusConversationPane(c.id); updateLayout(l => setOpen(l, false)); })} />}
        {c.empty && bindings[index]?.sessionId && <EmptyShelfRail hostId={bindings[index]!.hostId} sessionId={bindings[index]!.sessionId!} at="right" order={index * 3 + 3} paneId={c.id} focus={() => focusConversationPane(c.id)} />}
        {c.shelves.map(s => {
          const side = s.entry.shelf.side;
          const overlay = drawer && s.expanded && c.id === panes.focus;
          const overlayWidth = Math.min(Math.max(SHELF_MIN, c.budget * (ratios.shelves[index]?.[side] ?? .4)), Math.max(0, area - 48));
          return <div key={s.entry.shelf.id} data-fill-shelf={s.entry.shelf.id} data-fill-drawer={overlay ? "" : undefined} style={{ order: index * 3 + (side === "left" ? 1 : 3), width: s.width, flex: "none", marginLeft: index > 0 && side === "left" ? CARD_GAP : undefined }} className="relative flex min-h-0" onPointerDownCapture={() => focusConversationPane(c.id)} onFocusCapture={() => focusConversationPane(c.id)}>
            <div className={`flex min-h-0 min-w-0 ${overlay ? "absolute inset-y-0 z-30" : "flex-1"}`} style={overlay ? { width: overlayWidth, [side]: 0 } : undefined}>
              <div className={`flex min-h-0 min-w-0 flex-1 ${side === "left" ? "mr-2" : "ml-2"}`}>
                <Shelf entry={s.entry} registry={registry} ctx={c.ctx} resizable={false} currentWidth={() => Math.max(0, (overlay ? overlayWidth : s.width) - RAIL_WIDTH - CARD_GAP)} collapsed={!s.expanded || (drawer && !overlay)} at={side} />
              </div>
            </div>
          </div>;
        })}
        {c.shelves.filter(s => s.expanded && !drawer && !c.onlyShelf).map(s => {
          const side = s.entry.shelf.side;
          const leftBox = c.shelves.filter(x => x.entry.shelf.side === "left").reduce((a, b) => a + b.width, 0);
          const x = offsets[index]! + (side === "left" ? leftBox - CARD_GAP / 2 : leftBox + c.conv + CARD_GAP / 2);
          const pair = c.conv + s.width;
          return <FillEdge key={`edge-${s.entry.shelf.id}`} label={t("fillMode.divider")} x={x} width={s.width} min={SHELF_MIN} max={pair - CONV_MIN} sign={side === "left" ? 1 : -1} change={w => resizeShelf(index, side, w)} reset={() => { resizeShelf(index, side, Math.max(SHELF_MIN, Math.min(pair - CONV_MIN, (pair + CARD_GAP) / 2))); persistFillRatios(); }} />;
        })}
      </ShelfSourceContext.Provider>)}
      {computed.slice(1).map((c, i) => {
        const left = computed[i]!, right = computed[i + 1]!;
        if (left.strip || right.strip || left.onlyShelf || right.onlyShelf) return null;
        const lEdge = left.shelves.find(s => s.expanded && !drawer && s.entry.shelf.side === "right");
        const rEdge = right.shelves.find(s => s.expanded && !drawer && s.entry.shelf.side === "left");
        const lw = lEdge?.width ?? left.conv, rw = rEdge?.width ?? right.conv;
        const min = left.budget - Math.max(0, lw - (lEdge ? SHELF_MIN : CONV_MIN));
        const max = left.budget + Math.max(0, rw - (rEdge ? SHELF_MIN : CONV_MIN));
        return <FillEdge key={`column-${c.id}`} label={t("fillMode.divider")} x={offsets[i + 1]! - CARD_GAP / 2} width={left.budget} min={min} max={max} sign={1} change={w => resizeColumns(i, w)} reset={() => { resizeColumns(i, Math.max(min, Math.min(max, left.budget + (rw - (rEdge ? CARD_GAP : 0) - lw + (lEdge ? CARD_GAP : 0)) / 2))); persistFillRatios(); }} />;
      })}
    </div>
  </WsRowContext.Provider>;
}

function FillEdge({ label, x, width, min, max, sign, change, reset }: { label: string; x: number; width: number; min: number; max: number; sign: 1 | -1; change(width: number): void; reset(): void }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const end = () => { if (drag.current) { drag.current = null; resizeDrag(false); persistFillRatios(); } };
  return <div data-fill-edge="" role="separator" aria-label={label} aria-orientation="vertical" aria-valuemin={Math.round(min)} aria-valuemax={Math.round(max)} aria-valuenow={Math.round(width)} tabIndex={0} title={label}
    className="absolute inset-y-0 z-30 w-2 cursor-col-resize hover:bg-accent/30 focus-visible:bg-accent/40" style={{ left: x - 4 }}
    onDoubleClick={reset} onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); resizeDrag(true); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, width }; }}
    onPointerMove={e => { if (drag.current) change(clamp(drag.current.width + sign * (e.clientX - drag.current.x))); }} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
    onKeyDown={e => { const direction = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0; if (!direction) return; e.preventDefault(); change(clamp(width + direction * sign * (e.shiftKey ? 64 : 16))); persistFillRatios(); }} />;
}
