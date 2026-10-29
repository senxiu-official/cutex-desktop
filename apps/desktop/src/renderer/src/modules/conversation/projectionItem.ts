// The projection component (docs/desktop-modules.md §24.13; Projection.tsx draws it): another agent's live
// conversation in the focused conversation's Shelf. Multi (one per projected agent: dedupe host + session),
// bound to the conversation whose Shelf holds it (`agent`, filled from the focused agent at open — the Shelf
// is per conversation anyway). Placement: the page in view (it lands where the owner is looking). State = the
// projected agent (≤ 200 B); restored after a restart. Not in the launchers (opened by a drag, the tray, the
// agent menu).
import { MessagesSquare } from "lucide-react";
import { PROJECTION_COMPONENT, type ProjectionParams } from "../../lib/sideKinds";
import type { Json } from "../types";
import type { SideComponentItem, SideTabInfo, SideTabProps } from "../slots";
import { ProjectionActions, ProjectionBody } from "./Projection";
import { useAgentResource } from "./sideAgentData";
import { useApp, viewOf } from "../../store";
import { viewKey } from "../../lib/viewKey";

const ID = /^[^\s|]{1,200}$/;

export function parseProjection(raw: Json): ProjectionParams | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, Json>;
  return typeof r.sessionId === "string" && ID.test(r.sessionId) && typeof r.hostId === "string" && ID.test(r.hostId) ? { hostId: r.hostId, sessionId: r.sessionId } : null;
}

/** Title = the projected agent's name; busy while it runs; its pending approvals / questions as attention. */
function useProjectionTab({ instance }: SideTabProps<ProjectionParams>): SideTabInfo {
  const { hostId, sessionId } = instance.state;
  const resource = useAgentResource(hostId, sessionId);
  const view = useApp((s) => (s.views[viewKey(hostId, sessionId)] ? viewOf(s, hostId, sessionId) : undefined));
  const name = resource?.displayName ?? sessionId;
  const busy = !!(view ? view.timeline.activeTurnId : resource?.runtime.activeTurnId);
  const attention = view?.timeline.pending.size ?? 0;
  return { title: name, tooltip: name, busy, ...(attention ? { attention } : {}) };
}

export const projectionComponent: SideComponentItem<ProjectionParams, ProjectionParams> = {
  id: PROJECTION_COMPONENT,
  titleKey: "conversation.projection.title",
  icon: MessagesSquare,
  instances: "multi",
  defaultBinding: "agent",
  placement: { home: "projection", prefer: [{ containing: PROJECTION_COMPONENT }, "active"], otherwise: "active-page", order: 120 },
  minHeight: 220,
  parseParams: parseProjection,
  dedupeKey: (p) => `${p.hostId}|${p.sessionId}`,
  init: (p) => p,
  restore: (raw) => parseProjection(raw),
  useTab: useProjectionTab,
  Body: ProjectionBody,
  Actions: ProjectionActions,
};
