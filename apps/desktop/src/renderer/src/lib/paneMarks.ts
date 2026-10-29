// Which agents the conversation panes on screen show (the avatar rail's highlight, components/AgentRows
// RailAgent): the focused pane's agent strongly, the others' (side by side) lightly. A maximised pane
// hides the rest: only its agent counts. Panes in the tray (chips) are not on screen. Pure.
import { hostKey, type HostKey } from "./hostKeys";
import { conversationPanes, focusedConversation, paneBinding, type PaneLayout } from "./paneLayout";

export type PaneMark = "focused" | "shown";

const cache = new WeakMap<PaneLayout, ReadonlyMap<HostKey, PaneMark>>();

/** Host key (hostId, sessionId) → how its agent is on screen. Cached per layout object. */
export function paneMarks(layout: PaneLayout): ReadonlyMap<HostKey, PaneMark> {
  const hit = cache.get(layout);
  if (hit) return hit;
  const marks = new Map<HostKey, PaneMark>();
  const panes = conversationPanes(layout);
  const onScreen = layout.max && panes.includes(layout.max) ? [layout.max] : panes;
  const focused = focusedConversation(layout);
  for (const id of onScreen) {
    const b = paneBinding(layout, id);
    if (!b?.sessionId) continue;
    const key = hostKey(b.hostId, b.sessionId);
    if (id === focused || onScreen.length === 1) marks.set(key, "focused");
    else if (!marks.has(key)) marks.set(key, "shown");
  }
  cache.set(layout, marks);
  return marks;
}

/** One agent's mark (null: not on screen). */
export const paneMarkOf = (layout: PaneLayout, hostId: string, sessionId: string): PaneMark | null => paneMarks(layout).get(hostKey(hostId, sessionId)) ?? null;
