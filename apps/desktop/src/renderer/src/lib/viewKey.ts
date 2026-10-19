// Store keys of agent views (docs/research/panes-20261019.md §3, step 1c): the store holds the views
// (timeline, queue, …) of the agents shown or recently viewed — the main conversation's and the side
// pages' — keyed by host AND session id, `<host>\n<session id>`, so the same session id on two hosts
// never shares (or evicts) a view. A newline cannot occur in either id.

/** `<host id>\n<session id>`. */
export type ViewKey = string;

export const viewKey = (hostId: string, sessionId: string): ViewKey => `${hostId}\n${sessionId}`;

/** The host and session of a view key (a key without a newline: an empty host). */
export function viewKeyParts(key: ViewKey): { hostId: string; sessionId: string } {
  const at = key.indexOf("\n");
  return at < 0 ? { hostId: "", sessionId: key } : { hostId: key.slice(0, at), sessionId: key.slice(at + 1) };
}

/** The keys of one host's views. */
export const isViewOf = (key: ViewKey, hostId: string): boolean => key.startsWith(`${hostId}\n`);
