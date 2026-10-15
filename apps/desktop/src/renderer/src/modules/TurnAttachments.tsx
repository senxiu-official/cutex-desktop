// The `timeline.turnAttachment` outlet (docs/desktop-modules.md §19.3): module content shown with one
// turn — never in read-only timelines (sub-agent views, the reference card). An item that declares
// `margin` and whose gutter is at least `minWidth` wide sits in that gutter beside the turn's first
// line (scrolls with it; overlapping boxes pushed down, lib/marginLayout.ts); otherwise it renders
// inline at the end of the turn (a finished turn: in its last reply, after the turn summary and before
// the action row; else after the turn's last row; components/Timeline.tsx). Only rendered turns get
// attachments (the recentEntries window).
import { useLayoutEffect, useRef } from "react";
import { COLUMN_PADDING, marginWidth } from "../lib/gutterLayout";
import { useTurnAttachmentItems } from "../lib/gutterItems";
import { useGutter } from "../lib/gutterStore";
import { registerMargin } from "../lib/marginLayout";
import { agentHost, useApp } from "../store";
import { ItemBoundary } from "./Outlet";
import type { AppSlotEntry } from "./slots";

type Entry = AppSlotEntry<"timeline.turnAttachment">;

/** Where an item goes now: the gutter it asked for when wide enough, else inline. */
function useWhere(entry: Entry): { where: "inline" | "margin"; width: number } {
  const margin = entry.item.margin;
  const gutter = useGutter((s) => (margin ? (s.geometry?.[margin.side].width ?? 0) : 0));
  const column = useGutter((s) => Math.max(0, (s.geometry?.columnWidth ?? 0) - 2 * COLUMN_PADDING));
  if (margin && gutter >= margin.minWidth) return { where: "margin", width: marginWidth(gutter) };
  return { where: "inline", width: column };
}

function MarginBox({ entry, sessionId, turnId, width }: { entry: Entry; sessionId: string; turnId: string; width: number }) {
  const hostId = useApp(agentHost);
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
  const { where, width } = useWhere(entry);
  return where === "margin" ? <MarginBox entry={entry} sessionId={sessionId} turnId={turnId} width={width} /> : null;
}

function InlineItem({ entry, sessionId, turnId }: { entry: Entry; sessionId: string; turnId: string }) {
  const hostId = useApp(agentHost);
  const { where, width } = useWhere(entry);
  if (where !== "inline") return null;
  const Attachment = entry.item.Attachment;
  return (
    <ItemBoundary moduleId={entry.moduleId} resetKey={`${hostId}\u0000${sessionId}\u0000${turnId}`}>
      <Attachment hostId={hostId} sessionId={sessionId} turnId={turnId} where="inline" width={width} />
    </ItemBoundary>
  );
}

/** The zero-height anchor at a turn's first line: the margin boxes of the items placed in a gutter. */
export function TurnMargin({ sessionId, turnId }: { sessionId: string; turnId: string }) {
  const items = useTurnAttachmentItems(sessionId).filter((e) => e.item.margin);
  if (!items.length) return null;
  return (
    <div className="relative h-0">
      {items.map((e) => (
        <MarginItem key={e.item.id} entry={e} sessionId={sessionId} turnId={turnId} />
      ))}
    </div>
  );
}

/** Inline attachments at the end of a turn (items without a margin, or whose gutter is too narrow). */
export function TurnAttachments({ sessionId, turnId }: { sessionId: string; turnId: string }) {
  const items = useTurnAttachmentItems(sessionId);
  if (!items.length) return null;
  return (
    <div data-turn-attachments={turnId} className="flex flex-col gap-1 empty:hidden">
      {items.map((e) => (
        <InlineItem key={e.item.id} entry={e} sessionId={sessionId} turnId={turnId} />
      ))}
    </div>
  );
}
