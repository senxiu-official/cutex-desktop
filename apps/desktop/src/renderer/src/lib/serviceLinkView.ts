// Hooks + menu rows of the service ↔ agent UI (components/ServiceLinks; lib/serviceLink). Kept out of components/
// so Fast Refresh works.
import type { ServiceView } from "../../../shared/ipc";
import { useI18n } from "../i18n";
import { useApp } from "../store";
import type { MenuEntry } from "./contextMenu";
import { parseConvKey } from "./convShelves";
import { agentServices, openFromHeader, servicePanes, shelfOfConversation } from "./serviceLink";
import { serviceWhere } from "./servicesPopover";
import { liveConversation, useConvShelfVersion, useSide } from "./sideLayoutStore";

/** A host's service records (the focus host's own list, else its slice). */
export function useHostServices(hostId: string | null): ServiceView[] | null {
  return useApp((s) => (!hostId ? null : hostId === (s.hosts?.active ?? "local") ? s.services : (s.byHost[hostId]?.services ?? null)));
}

/** The session whose Shelf is the live one (it re-renders when that changes). */
export function useLiveSession(hostId: string | null): string | null {
  useConvShelfVersion((s) => s.n);
  const key = liveConversation();
  const k = key ? parseConvKey(key) : null;
  return k && k.hostId === hostId ? k.sessionId : null;
}

/** Whether service `slug` has a pane in the conversation's Shelf (re-renders with the Shelves). */
export function useInShelf(hostId: string, sessionId: string): (slug: string) => boolean {
  useSide((s) => s.layout);
  useConvShelfVersion((s) => s.n);
  const layout = shelfOfConversation(hostId, sessionId);
  return (slug) => servicePanes(layout, hostId, slug).length > 0;
}

/** The ⋯ overflow's rows for the agent's services (a narrow column folded the 「N 个服务」 entry). */
export function agentServiceMenu(t: ReturnType<typeof useI18n>["t"], paneId: string, hostId: string, sessionId: string, list: readonly ServiceView[], inShelf: (slug: string) => boolean): MenuEntry[] {
  return list.map((s) => ({
    label: [`${s.health === "reachable" ? "●" : "○"} ${s.displayName || s.slug}`, serviceWhere(s, t("svcLink.static"))].filter(Boolean).join("  "),
    hint: t(inShelf(s.slug) ? "svcLink.locate" : "svcLink.open"),
    onSelect: () => void openFromHeader(paneId, hostId, sessionId, s),
  }));
}

/** The services of the header's agent (empty: none) and its ⋯ rows. */
export function useAgentServiceList(paneId: string, hostId: string, sessionId: string) {
  const { t } = useI18n();
  const all = useHostServices(hostId);
  const inShelf = useInShelf(hostId, sessionId);
  const mine = agentServices(all, sessionId);
  return { mine, up: mine.filter((s) => s.health === "reachable").length, menu: () => agentServiceMenu(t, paneId, hostId, sessionId, mine, inShelf) };
}

