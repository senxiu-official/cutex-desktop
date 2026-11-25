// What the address bar does with typed text (design browser-profiles v3 §10): a web address opens; anything else is a
// search with the owner's engine (one setting for all identities). An explicit scheme or a host-like word is an
// address; spaces, no dot, or a leading `?` make a search. A single bare word (`intranet`) searches and offers
// 「打开 http://intranet/」. Syntax only: main checks every navigation as before.
import { browserSearchUrl, type BrowserSearchEngine } from "../../../../shared/browserIdentity";
import { browserAddressUrl, browserNavigationUrl, NOT_WEB_ADDRESS } from "./browserState";

export type AddressInput =
  | { kind: "url"; url: string }
  | { kind: "search"; url: string; query: string; /** A bare word could be an intranet host: offered, not chosen. */ alt?: string }
  | { kind: "error"; error: string };

const EXPLICIT = /^[a-z][a-z0-9+.-]*:\/\/|^(?:about|cutex|javascript|data|file|blob|mailto|view-source|chrome|devtools):/i;
const BARE_WORD = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?::\d{1,5})?$/i;

export function classifyAddress(raw: string, engine: BrowserSearchEngine): AddressInput {
  const text = raw.trim();
  if (text.startsWith("?")) {
    const query = text.slice(1).trim();
    return query ? { kind: "search", url: browserSearchUrl(engine, query), query } : { kind: "error", error: NOT_WEB_ADDRESS };
  }
  const typed = browserAddressUrl(text);
  if ("url" in typed) return { kind: "url", url: typed.url };
  // An explicit scheme that is refused stays an error (never searched: `javascript:` is not a query).
  if (EXPLICIT.test(text) || text.startsWith("cutex:")) return { kind: "error", error: typed.error };
  if (typed.error !== NOT_WEB_ADDRESS && !/\s/.test(text)) return { kind: "error", error: typed.error };
  const search = { kind: "search" as const, url: browserSearchUrl(engine, text), query: text };
  if (BARE_WORD.test(text) && !/^\d+$/.test(text.split(":")[0]!)) {
    const alt = browserNavigationUrl(`http://${text.toLowerCase()}/`);
    if (alt) return { ...search, alt };
  }
  return search;
}
