import { useMemo } from "react";
import { agentHost, sidebarOf, useApp, viewHostOf, viewOf } from "../../store";
import { useI18n } from "../../i18n";
import { agentFeaturesOf, lacks } from "../../lib/agentFeatures";
import { useAgentFeatures } from "../../lib/agentFeaturesView";
import type { CutexRef, SideTabProps } from "../slots";
import type { SideState } from "./cardState";
import { sideKey, useSides } from "./state";

type State = ReturnType<typeof useApp.getState>;
export function parentResource(s: State, hostId: string, sessionId: string | null) {
  const sidebar = sidebarOf(s, hostId);
  return sidebar?.active.find(r => r.cutexSessionId === sessionId) ?? sidebar?.retired.find(r => r.cutexSessionId === sessionId);
}
export function launcherParams() {
  const s = useApp.getState(), resource = parentResource(s, agentHost(s), s.selectedId);
  // Codex agents, and Claude agents whose adapter declares sideChat (claude-r21+).
  return resource?.runtime.status === "online" && !lacks(agentFeaturesOf(resource), "sideChat") ? {} : null;
}
export function useFromTurnState(ref: CutexRef) {
  const { t } = useI18n();
  const focusFeatures = useAgentFeatures(ref.params.sessionId ?? null);
  // useAgentFeatures reads the open agent's own host row (also for another host's agent).
  const viewHost = useApp(s => ref.params.sessionId ? viewHostOf(ref.params.sessionId) : agentHost(s));
  const resource = useApp(s => parentResource(s, ref.hostId, ref.params.sessionId ?? null));
  const features = ref.hostId === viewHost ? focusFeatures : agentFeaturesOf(resource);
  return lacks(features, "sideChat") ? { disabledReason: t("side-chat.runtimeUnsupported") }
    : resource?.runtime.status !== "online" ? { disabledReason: t("side-chat.offline") } : null;
}
export function useSideTab({ instance, hostId }: SideTabProps<SideState>) {
  const { t } = useI18n();
  const view = useSides(s => hostId && instance.state.chatId ? s.views[sideKey(hostId, instance.state.chatId)] : undefined);
  return { title: t("side-chat.title"), busy: view?.chat.status === "running", unread: !!view?.unread };
}
/** 「#12」 for a turn of the loaded main timeline (all its earlier turns loaded too); null when it can't be told. */
export function useTurnLabel(hostId: string, sessionId: string, turnId: string | null | undefined) {
  return useApp(s => {
    if (!turnId) return null;
    const view = viewOf(s, hostId, sessionId), index = view?.timeline.turns.findIndex(t => t.id === turnId) ?? -1;
    return view && !view.older && index >= 0 ? `#${index + 1}` : null;
  });
}

/** The side chat's source turn in a few words (owner 2026-11-28): the owner's message, the start of the turn's last
 *  reply, its ordinal and start time; null while that turn isn't in the loaded main timeline. */
export interface SourceTurnExcerpt { ordinal: number | null; startedAt: number | null; ask: string; reply: string }
const EXCERPT = 280;
const oneLine = (text: string) => text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#*_`>]+/g, "").replace(/\s+/g, " ").trim().slice(0, EXCERPT);
export function useSourceTurn(hostId: string, sessionId: string, turnId: string): SourceTurnExcerpt | null {
  // One string (compared by value) so the main timeline's other updates don't re-render the card.
  const key = useApp(s => {
    const view = viewOf(s, hostId, sessionId), timeline = view?.timeline;
    const index = timeline?.turns.findIndex(t => t.id === turnId) ?? -1;
    const turn = index >= 0 ? timeline!.turns[index]! : null;
    if (!turn) return "";
    const entries = turn.entryIds.map(id => timeline!.entries.get(id));
    const ask = entries.find(e => e?.kind === "user");
    const reply = entries.findLast(e => e?.kind === "agent" && e.text.trim());
    return JSON.stringify([view!.older ? null : index + 1, turn.startedAt, ask?.kind === "user" ? oneLine(ask.text) : "", reply?.kind === "agent" ? oneLine(reply.text) : ""]);
  });
  return useMemo(() => {
    if (!key) return null;
    const [ordinal, startedAt, ask, reply] = JSON.parse(key) as [number | null, number | null, string, string];
    return { ordinal, startedAt, ask, reply };
  }, [key]);
}
