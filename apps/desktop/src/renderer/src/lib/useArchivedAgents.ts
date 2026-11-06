// Archived agents are read on demand (main/sessionDeltaCatalog; store ensureArchived): the views that list
// or name them ask for them while shown. Everything else names an archived agent from its own data, or by ID.
import { useEffect } from "react";
import { useApp } from "../store";

type Lists = { sidebar?: { archivedPending?: unknown } | null; byHost?: Record<string, { sidebar?: { archivedPending?: unknown } | null } | undefined> };

/** Some host in view has not read its archived agents yet. */
export const archivedUnread = (state: Lists): boolean =>
  !!state.sidebar?.archivedPending || Object.values(state.byHost ?? {}).some((h) => !!h?.sidebar?.archivedPending);

/** Reads the archived agents of `hostId` (default: every host) while the calling view is shown. */
export function useArchivedAgents(hostId?: string | null): void {
  // Again when a host's list loses them (reconnect, access change) while the view stays open.
  const pending = useApp(archivedUnread);
  useEffect(() => { if (pending) void useApp.getState().ensureArchived(hostId ?? undefined); }, [hostId, pending]);
}
