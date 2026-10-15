// conversation.overlay: service reveal cards (「Reader 想给你看：Doodle · 打开」) for the agent in view.
import { AgentToasts } from "../../components/AgentToasts";
import type { OverlayLayout } from "../slots";
import { TOAST_OWNER } from "./live";

export function ServiceToasts({ sessionId, reserve }: { sessionId: string; reserve(layout: OverlayLayout | null): void }) {
  return <AgentToasts owner={TOAST_OWNER} sessionId={sessionId} reserve={reserve} />;
}
