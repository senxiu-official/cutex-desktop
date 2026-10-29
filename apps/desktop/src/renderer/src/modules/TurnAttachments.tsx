// The `timeline.turnAttachment` outlet (docs/desktop-modules.md §19.3): module content shown with one
// turn — never in read-only timelines (sub-agent views, the reference card). An item that declares
// `margin` and whose gutter is at least `minWidth` wide sits in that gutter beside the turn's first
// line (scrolls with it; overlapping boxes pushed down, lib/marginLayout.ts); otherwise it renders
// inline at the end of the turn (a finished turn: in its last reply, after the turn summary and before
// the action row; else after the turn's last row; components/Timeline.tsx). Only rendered turns get
// attachments (the recentEntries window).
import { memo, useDeferredValue, useLayoutEffect, useRef } from "react";
import { COLUMN_PADDING, marginWidth } from "../lib/gutterLayout";
import { useTurnAttachmentItems } from "../lib/gutterItems";
import { useGutter } from "../lib/gutterStore";
import { registerMargin } from "../lib/marginLayout";
import { useConvHost } from "../lib/conversationScope";
import { ItemBoundary } from "./Outlet";
import type { AppSlotEntry } from "./slots";

type Entry = AppSlotEntry<"timeline.turnAttachment">;

/** Whether an item sits in its gutter now (it asked for one and that gutter is wide enough). */
function useInMargin(entry: Entry): boolean {
  const margin = entry.item.margin;
  return useGutter((s) => !!margin && (s.geometry?.[margin.side].width ?? 0) >= margin.minWidth);
}

/** The width of an item in its gutter (0 while it is inline): it re-renders only with that gutter. */
function useMarginWidth(entry: Entry): number {
  const margin = entry.item.margin;
  return useGutter((s) => {
    const gutter = margin ? (s.geometry?.[margin.side].width ?? 0) : 0;
    return margin && gutter >= margin.minWidth ? marginWidth(gutter) : 0;
  });
}

/** Inline widths are handed out in steps of this many px (rounded down: never wider than the column). */
export const INLINE_WIDTH_STEP = 8;

/**
 * The width of an inline item: the reading column's, less its padding, rounded down to INLINE_WIDTH_STEP — so a
 * window or column drag renders the turns' attachments every 8 px, not on every step (perf audit 2026-10-23 §2.5,
 * owner 2026-10-23).
 */
export function inlineWidth(columnWidth: number): number {
  const w = Math.max(0, columnWidth - 2 * COLUMN_PADDING);
  return w - (w % INLINE_WIDTH_STEP);
}

function useInlineWidth(): number {
  return useGutter((s) => inlineWidth(s.geometry?.columnWidth ?? 0));
}

function MarginBox({ entry, sessionId, turnId, width }: { entry: Entry; sessionId: string; turnId: string; width: number }) {
  const hostId = useConvHost();
  const box = useRef<HTMLDivElement>(null);
  const side = entry.item.margin!.side;
  useLayoutEffect(() => {
    const el = box.current;
    const anchor = el?.parentElement;
    if (!el || !anchor) return;
    return registerMargin(`${entry.item.id}\u0000${turnId}`, side, anchor, el);
  }, [entry.item.id, turnId, side]);
  const Attachment = entry.item.Attachment;
  return (
    <div
      ref={box}
      data-turn-margin={entry.item.id}
      data-gutter-root
      className="absolute top-0 z-[4]"
      style={side === "left" ? { right: "calc(100% + 8px)", width } : { left: "calc(100% + 8px)", width }}
    >
      <ItemBoundary moduleId={entry.moduleId} resetKey={`${hostId}\u0000${sessionId}\u0000${turnId}`}>
        <Attachment hostId={hostId} sessionId={sessionId} turnId={turnId} where="margin" width={width} />
      </ItemBoundary>
    </div>
  );
}

function MarginItem({ entry, sessionId, turnId }: { entry: Entry; sessionId: string; turnId: string }) {
  const width = useMarginWidth(entry);
  return width > 0 ? <MarginBox entry={entry} sessionId={sessionId} turnId={turnId} width={width} /> : null;
}

/**
 * One inline item (memo): it re-renders when it moves between inline and its gutter, or when the turn hands it a new
 * width — taken at low priority (TurnAttachments): on every step of a column / window resize each turn's
 * attachments used to re-render (perf re-run 2026-10-21 §7.3 N1).
 */
const InlineItem = memo(function InlineItem({ entry, sessionId, turnId, width }: { entry: Entry; sessionId: string; turnId: string; width: number }) {
  const hostId = useConvHost();
  if (useInMargin(entry)) return null;
  const Attachment = entry.item.Attachment;
  return (
    <ItemBoundary moduleId={entry.moduleId} resetKey={`${hostId}\u0000${sessionId}\u0000${turnId}`}>
      <Attachment hostId={hostId} sessionId={sessionId} turnId={turnId} where="inline" width={width} />
    </ItemBoundary>
  );
});

// Both are memo: the timeline re-renders on every streamed frame, a turn's attachments (bookmarks,
// notes, shots) only change with their own stores.

/** The zero-height anchor at a turn's first line: the margin boxes of the items placed in a gutter. */
export const TurnMargin = memo(function TurnMargin({ sessionId, turnId }: { sessionId: string; turnId: string }) {
  const items = useTurnAttachmentItems(sessionId).filter((e) => e.item.margin);
  if (!items.length) return null;
  return (
    <div className="relative h-0">
      {items.map((e) => (
        <MarginItem key={e.item.id} entry={e} sessionId={sessionId} turnId={turnId} />
      ))}
    </div>
  );
});

/** Inline attachments at the end of a turn (items without a margin, or whose gutter is too narrow). */
export const TurnAttachments = memo(function TurnAttachments({ sessionId, turnId }: { sessionId: string; turnId: string }) {
  const items = useTurnAttachmentItems(sessionId);
  if (!items.length) return null;
  return <InlineList items={items} sessionId={sessionId} turnId={turnId} />;
});

function InlineList({ items, sessionId, turnId }: { items: readonly Entry[]; sessionId: string; turnId: string }) {
  // The column's width changes on every step of a resize: the items get it in a background render (dropped when
  // the next step comes first), not in the step's own commit.
  const width = useDeferredValue(useInlineWidth());
  return (
    <div data-turn-attachments={turnId} className="flex flex-col gap-1 empty:hidden">
      {items.map((e) => (
        <InlineItem key={e.item.id} entry={e} sessionId={sessionId} turnId={turnId} width={width} />
      ))}
    </div>
  );
}
