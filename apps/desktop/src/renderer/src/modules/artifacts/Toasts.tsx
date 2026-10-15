// conversation.overlay: this module's cards (「demo-writer 发布了 doodle.html v2 · 查看」) for the agent in view.
import { AgentToasts } from "../../components/AgentToasts";
import type { OverlayLayout } from "../slots";
import { TOAST_OWNER } from "./live";

export function ArtifactToasts({ sessionId, reserve }: { sessionId: string; reserve(layout: OverlayLayout | null): void }) {
  return <AgentToasts owner={TOAST_OWNER} sessionId={sessionId} reserve={reserve} />;
}
