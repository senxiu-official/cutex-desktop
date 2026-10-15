// React / app side of the status categories (`conversation.status`) and their surfaces
// (`conversation.statusSurface`, docs/desktop-modules.md §16): the shell's (StatusBar / Conversation /
// Settings) and the capsule module's only view of them. Kept out of components/*.tsx (Fast Refresh).
import { useMemo } from "react";
import { appModules } from "../modules/app";
import { useModuleStatuses, usePlacement, useSlot } from "../modules/react";
import type { RevealIntent, RevealResult, StatusItem, StatusPlace } from "../modules/slots";
import { useAgentFeatures } from "./agentFeaturesView";
import type { TimelineState } from "./timeline";
import { agentHost, useApp } from "../store";
import { placedStatusItems, type PlacedStatus } from "./statusItems";
import { itemSurfaces, resolvePlacement, revealStatus, surfaceProviders, type ResolvedPlacement, type RevealScope, type SurfaceProviders } from "./statusSurfaces";

/** The provider of each status surface right now (whether its module is on / available). */
export function useSurfaceProviders(): SurfaceProviders {
  const shown = useSlot("conversation.statusSurface");
  const statuses = useModuleStatuses();
  const modules = appModules().modules;
  return useMemo(() => surfaceProviders(modules, statuses, shown), [modules, statuses, shown]);
}

const resolverFor = (providers: SurfaceProviders) => (item: StatusItem, place: StatusPlace) => {
  const supported = itemSurfaces(item);
  return { supported, resolved: resolvePlacement(place, supported, providers) };
};

/** Status items of an agent (null = no agent: every available one), in order, with placement. */
export function useStatusItems(sessionId: string | null): PlacedStatus[] {
  const entries = useSlot("conversation.status");
  const placeOf = usePlacement("conversation.status");
  const agent = useAgentFeatures(sessionId);
  const providers = useSurfaceProviders();
  return useMemo(() => placedStatusItems(entries, placeOf, sessionId ? agent : null, resolverFor(providers)), [entries, placeOf, agent, sessionId, providers]);
}

/** Resolved placement of one status item; null while its module is off / unavailable. */
export function useStatusPlacement(itemId: string): ResolvedPlacement | null {
  const entries = useSlot("conversation.status");
  const placeOf = usePlacement("conversation.status");
  const providers = useSurfaceProviders();
  const entry = entries.find((e) => e.item.id === itemId && e.mode === "show");
  return useMemo(() => (entry ? resolverFor(providers)(entry.item, placeOf(entry.item) as StatusPlace).resolved : null), [entry, placeOf, providers]);
}

export function setStatusPlace(item: StatusItem, place: StatusPlace): void {
  appModules().setPlacement("conversation.status", item, place);
}

/** Providers from the host's current snapshot (outside React). */
function currentProviders(): SurfaceProviders {
  const host = appModules();
  return surfaceProviders(host.modules, host.statuses(), host.snapshot("conversation.statusSurface"));
}

/**
 * `statusPresentation.reveal` (§16.4) bound to the app: the scope is the host + agent the caller
 * rendered for. The item is looked up with the agent's features, as the status row sees it.
 */
export function revealStatusItem(scope: RevealScope, itemId: string, intent: RevealIntent, openBarPanel?: () => void): RevealResult {
  const host = appModules();
  return revealStatus(
    {
      current: () => {
        const s = useApp.getState();
        return { hostId: agentHost(s), sessionId: s.view.kind === "conversation" ? s.selectedId : null };
      },
      providers: currentProviders,
      item: (id) => {
        const entry = host.snapshot("conversation.status").find((e) => e.item.id === id && e.mode === "show");
        if (!entry) return null;
        return resolverFor(currentProviders())(entry.item, host.placement("conversation.status", entry.item) as StatusPlace);
      },
    },
    scope,
    itemId,
    intent,
    openBarPanel,
  );
}

/**
 * An agent's timeline for status items. The timeline is mutated in place, so this also subscribes
 * to its `version` (every change re-renders the caller).
 */
export function useSessionTimeline(sessionId: string): TimelineState | null {
  useApp((s) => s.sessions[sessionId]?.version ?? 0);
  return useApp((s) => s.sessions[sessionId]?.timeline ?? null);
}
