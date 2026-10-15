// Per-item boundaries and core fallbacks for the predefined timeline slots (§3.5).
import { useContext, type ReactNode } from "react";
import { TimelineFallbackContext as Fallback } from "./timelineFallback";
import { receivedRendererFor } from "../lib/receivedRows";
import { toolRendererFor } from "../lib/timelineRenderers";
import type { ExternalMessage, RawItem } from "../lib/timeline";
import { PlainToolRow } from "../components/PlainToolRow";
import { ItemBoundary } from "./Outlet";
import { TimelineViewContext, useTimelineView, type TimelineView } from "./timelineItemsView";

class TimelineBoundary extends ItemBoundary {
  declare props: ItemBoundary["props"] & { fallback: ReactNode };
  render() {
    // A renderer crash keeps the ordinary row visible as well as the standard module error/retry UI.
    return <>{super.render()}{this.state.error && this.props.fallback}</>;
  }
}

/** Rows read the view TimelineBody computed once; a row mounted elsewhere computes its own. */
function WithView({ sessionId, children }: { sessionId: string; children: (view: TimelineView) => ReactNode }) {
  const view = useTimelineView(sessionId);
  return <TimelineViewContext.Provider value={view}>{children(view)}</TimelineViewContext.Provider>;
}

function withView(sessionId: string, view: TimelineView | null, render: (view: TimelineView) => ReactNode): ReactNode {
  return view && view.sessionId === sessionId ? render(view) : <WithView sessionId={sessionId}>{render}</WithView>;
}

const resetKey = (view: TimelineView, itemId: string) => `${view.hostId}\u0000${itemId}\u0000${view.sessionId}`;

export function ReceivedOutlet({ message, sessionId, readOnly, fallback }: { message: ExternalMessage; sessionId: string; readOnly: boolean; fallback: ReactNode }) {
  return withView(sessionId, useContext(TimelineViewContext), (view) => {
    const entry = receivedRendererFor(message, view.received, view.agent);
    if (!entry) return <>{fallback}</>;
    const { Row } = entry.item;
    return (
      <Fallback.Provider value={fallback}>
        <TimelineBoundary moduleId={entry.moduleId} resetKey={resetKey(view, entry.item.id)} fallback={fallback}>
          <Row message={message} sessionId={sessionId} readOnly={readOnly} />
        </TimelineBoundary>
      </Fallback.Provider>
    );
  });
}

export function ToolOutlet({ item, sessionId }: { item: RawItem; sessionId: string }) {
  return withView(sessionId, useContext(TimelineViewContext), (view) => {
    const entry = toolRendererFor(item, view.tools);
    const fallback = <PlainToolRow item={item} />;
    if (!entry) return fallback;
    const { Row } = entry.item;
    return (
      <Fallback.Provider value={fallback}>
        <TimelineBoundary moduleId={entry.moduleId} resetKey={resetKey(view, entry.item.id)} fallback={fallback}>
          <Row item={item} sessionId={sessionId} />
        </TimelineBoundary>
      </Fallback.Provider>
    );
  });
}
