// Which host an agent is opened on (store `select`). Pure; unit-tested in test/agentHostRoute.test.ts.
//
// Agent ids are cutex session ids (UUID-based), so the host whose sidebar lists an id is the one that
// can answer for it. Callers that do not know the agent's host (links in a timeline, party names,
// delegation cards, plugin `openAgent`) used to fall back to the focus host: with 所有设备 an agent of
// another host then opened on the focus host's daemon, which answers 404 `session_not_found` ("does
// not exist on this host"). The preferred host still wins whenever it lists the agent (or nobody
// does: a just-created agent before its host's sidebar refresh).

/** A host's sidebar knowledge of one agent: true = listed (active or archived), false = not listed, null = no snapshot. */
export type ListsAgent = (hostId: string) => boolean | null;

/**
 * The host to open `sessionId` on: `preferred` when it lists the agent; else the one host of
 * `candidates` (the hosts in the view scope) that lists it — `tieBreak` (the open agent's host) when
 * several do; else `preferred`.
 */
export function routeAgentHost(preferred: string, candidates: readonly string[], lists: ListsAgent, tieBreak?: string): string {
  if (lists(preferred)) return preferred;
  const listing = [...new Set(candidates)].filter((host) => host !== preferred && lists(host) === true);
  if (listing.length === 1) return listing[0]!;
  if (tieBreak !== undefined && listing.includes(tieBreak)) return tieBreak;
  return preferred;
}
