// The side agent view (docs/research/side-agent-view-20261018.md): another agent's live conversation as a
// right-side card — its timeline, status line, 「接下来」 queue and a slim composer — while the main area
// keeps the current agent. Multi (one tab per agent, key = session id), bound to the agent's host so it
// stays whatever agent the main area shows; page group `agents` (desktop-modules.md §18.6). Live while
// mounted: the off-screen ones stay mounted (and subscribed) within the side keep limits.
import { MessagesSquare } from "lucide-react";
import { SIDE_AGENT_COMPONENT, type SideAgentParams } from "../../lib/sideKinds";
import type { SideComponentItem } from "../slots";
import { SideAgentBody } from "./SideAgent";
import { parseSideAgent, useSideAgentTab } from "./sideAgentData";

export const sideAgentComponent: SideComponentItem<SideAgentParams, SideAgentParams> = {
  id: SIDE_AGENT_COMPONENT,
  titleKey: "conversation.agent",
  icon: MessagesSquare,
  instances: "multi",
  defaultBinding: "host",
  placement: { home: "agents", order: 100 },
  keepAlive: "hidden",
  minHeight: 260,
  parseParams: parseSideAgent,
  dedupeKey: (p) => p.sessionId,
  init: (p) => p,
  restore: (raw) => parseSideAgent(raw),
  useTab: useSideAgentTab,
  Body: SideAgentBody,
};
