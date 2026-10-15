// Outlet of `conversation.overlay` (docs/desktop-modules.md §16.5): every available overlay item of
// the agent, each in its own error boundary, reporting the space it reserves. The conversation mounts
// this and never names an overlay (the status capsule is one, from module `status-capsule`).
import { useCallback } from "react";
import { lacks } from "../lib/agentFeatures";
import { useAgentFeatures } from "../lib/agentFeaturesView";
import { ItemBoundary } from "./Outlet";
import { useSlot } from "./react";
import type { AppSlotEntry, OverlayLayout } from "./slots";

function OverlayEntry({ entry, sessionId, onReserve }: { entry: AppSlotEntry<"conversation.overlay">; sessionId: string; onReserve(id: string, layout: OverlayLayout | null): void }) {
  const id = entry.item.id;
  const reserve = useCallback((layout: OverlayLayout | null) => onReserve(id, layout), [id, onReserve]);
  const { Overlay } = entry.item;
  return (
    // `data-overlay-item` (display: contents): the conversation measures what a reserving item draws.
    <div data-overlay-item={id} className="contents">
      <ItemBoundary moduleId={entry.moduleId} resetKey={sessionId}>
        <Overlay sessionId={sessionId} reserve={reserve} />
      </ItemBoundary>
    </div>
  );
}

/** `onReserve` must be stable; an overlay that unmounts (module off, render error) reports null. */
export function ConversationOverlays({ sessionId, onReserve }: { sessionId: string; onReserve(id: string, layout: OverlayLayout | null): void }) {
  const entries = useSlot("conversation.overlay");
  const agent = useAgentFeatures(sessionId);
  // `data-overlay-root` is `display: contents` (the overlays still position against the conversation);
  // the gutter host measures the boxes drawn inside it and keeps its own content clear of them (§19.2).
  return (
    <div data-overlay-root className="contents">
      {entries
        .filter((e) => e.mode === "show" && !(agent && e.item.agentFeature && lacks(agent, e.item.agentFeature)))
        .map((e) => (
          <OverlayEntry key={e.item.id} entry={e} sessionId={sessionId} onReserve={onReserve} />
        ))}
    </div>
  );
}
