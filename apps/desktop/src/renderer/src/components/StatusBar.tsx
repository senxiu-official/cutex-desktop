// Status row right above the input — the "bar" status surface (docs/desktop-modules.md §3.2, §16):
// the `conversation.status` items' Bar parts. Every item available for the agent is mounted here
// whatever its placement — it draws its chip only when its effective placement includes the bar, and
// takes the requests (slash commands, chips) for it: `reveal` picks the surface (the capsule when it
// alone shows the item, else the Bar's own panel). Items with `barSide: "start"` grow on the left,
// the rest sit on the right. Each panel floats up over the timeline, positioned against this row.
// Always mounted (an empty row has no height beyond its one line). The 需要你 bell (components/NeedsYou, owner
// 2026-11-05) and the open agent's pending owner notices (components/PendingOwnerNotes) lead the start side. A narrow
// row shortens the right-side chips, then wraps; it never shrinks while its width stays (lib/statusRow).
import { useCallback } from "react";
import { useI18n } from "../i18n";
import { ItemBoundary } from "../modules/Outlet";
import type { RevealIntent } from "../modules/slots";
import { shownOn, type PlacedStatus } from "../lib/statusItems";
import { revealStatusItem, useStatusItems } from "../lib/statusItemsView";
import { legacyHome } from "../lib/statusSurfaces";
import { dataFlags, useSizeFlags } from "../lib/sizeFlags";
import { STATUS_ROW_FLAGS, useStickyHeight } from "../lib/statusRow";
import { convNotify, useConvHost, useConvScope } from "../lib/conversationScope";
import { PendingOwnerNotes } from "./PendingOwnerNotes";
import { NeedsYouBell } from "./NeedsYou";

function BarPart({ sessionId, hostId, placed }: { sessionId: string; hostId: string; placed: PlacedStatus }) {
  const { t } = useI18n();
  const { item, moduleId, resolved } = placed;
  const conv = useConvScope();
  const Bar = item.Bar;
  if (!Bar) return null;
  const reveal = (intent: RevealIntent, openBarPanel?: () => void) => {
    const result = revealStatusItem({ hostId, sessionId }, item.id, intent, openBarPanel, conv);
    // Never "nothing happened": the caller asked to see it.
    if (result.status === "unavailable" && openBarPanel) convNotify(conv, t("status.revealUnavailable", { item: t(item.titleKey) }));
    return result;
  };
  return (
    <ItemBoundary moduleId={moduleId} resetKey={sessionId}>
      <Bar sessionId={sessionId} inline={shownOn(placed, "bar")} reveal={reveal} home={legacyHome(resolved)} showInCapsule={() => void reveal("view")} />
    </ItemBoundary>
  );
}

export function StatusBar({ sessionId }: { sessionId: string }) {
  const items = useStatusItems(sessionId);
  // The conversation's host (it may not be the focus host; lib/conversationScope).
  const hostId = useConvHost();
  const [sizeRef, flags] = useSizeFlags(STATUS_ROW_FLAGS);
  const stickyRef = useStickyHeight();
  const ref = useCallback((el: HTMLDivElement | null) => {
    const stopSize = sizeRef(el);
    stickyRef(el);
    return () => {
      stopSize?.();
      stickyRef(null);
    };
  }, [sizeRef, stickyRef]);
  const side = (s: "start" | "end") =>
    items
      .filter((p) => (p.item.barSide ?? "end") === s)
      .map((p) => <BarPart key={p.item.id} sessionId={sessionId} hostId={hostId} placed={p} />);
  return (
    <div ref={ref} {...dataFlags(flags)} data-status-row="" className="group/status side-col side-col-composer relative flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-6">
      {/* Outside the start part, so it shares the first line however the start part wraps. */}
      <NeedsYouBell />
      <div data-status-start="" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
        {/* The open agent's notices waiting for the owner (等你回复 / 需要你): first, before the items. */}
        <PendingOwnerNotes sessionId={sessionId} hostId={hostId} />
        {side("start")}
      </div>
      <div data-status-end="" className="ml-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-1 empty:hidden">{side("end")}</div>
    </div>
  );
}
