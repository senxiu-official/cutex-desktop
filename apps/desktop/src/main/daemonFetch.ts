import { fetch as fetchWithFixedParser } from "undici";

/** Electron 44 embeds undici 7.29.1: a peer FIN while the body is paused throws
 * outside the fetch promise (nodejs/undici#5360). Use the pinned, fixed parser
 * for daemon HTTP, including media and SSE. Never change renderer networking or
 * suppress process exceptions; unrelated failures retain their normal handling.
 * Both implementations expose WHATWG Request/Response; their TS types differ. */
export const daemonFetch = fetchWithFixedParser as unknown as typeof globalThis.fetch;
