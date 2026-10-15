// Gutter triggers in the composer's toolbar (docs/desktop-modules.md §19.2): when a gutter is too
// narrow for them (G + 24 < 44: full-width column, small window), the left gutter's items sit at the
// toolbar's left end and the right gutter's at its right end. Same popovers, anchored to the button.
import { useRef } from "react";
import { POPOVER_MAX, POPOVER_MIN } from "../../lib/gutterLayout";
import { useGutterItems, type GutterEntry } from "../../lib/gutterItems";
import { setGutterPopover, useGutter } from "../../lib/gutterStore";
import { GutterPopover } from "./GutterPopover";
import { GutterTrigger } from "./GutterTrigger";

export function ComposerTriggers({ hostId, sessionId, side }: { hostId: string; sessionId: string; side: "left" | "right" }) {
  const items = useGutterItems(sessionId, hostId)[side];
  const inComposer = useGutter((s) => s.geometry?.[side].trigger === "composer");
  const popover = useGutter((s) => s.popover);
  const triggers = useRef(new Map<string, HTMLDivElement>());
  if (!inComposer || !items.length) return null;
  const withBody = items.filter((e) => e.item.anchor !== "top" && (e.item.Body || e.item.Trigger));
  if (!withBody.length) return null;
  const open: GutterEntry | undefined = withBody.find((e) => e.item.id === popover && e.item.Body);
  const anchor = open ? triggers.current.get(open.item.id) : undefined;
  const rect = anchor?.getBoundingClientRect();
  const width = Math.max(POPOVER_MIN, Math.min(POPOVER_MAX, window.innerWidth - 32));
  return (
    <div data-gutter-root className="flex items-center gap-0.5">
      {withBody.map((e) => (
        <GutterTrigger
          key={e.item.id}
          ref={(el) => void (el ? triggers.current.set(e.item.id, el) : triggers.current.delete(e.item.id))}
          entry={e}
          hostId={hostId}
          sessionId={sessionId}
          where="composer"
          open={popover === e.item.id}
          toggle={() => setGutterPopover(popover === e.item.id ? null : e.item.id, triggers.current.get(e.item.id) ?? null)}
        />
      ))}
      {open && anchor && rect && (
        <GutterPopover
          entry={open}
          hostId={hostId}
          sessionId={sessionId}
          side={side}
          anchor={anchor}
          edge={side === "left" ? Math.max(8, rect.left) : Math.max(8, window.innerWidth - rect.right)}
          top={8}
          width={width}
          close={() => setGutterPopover(null)}
        />
      )}
    </div>
  );
}
