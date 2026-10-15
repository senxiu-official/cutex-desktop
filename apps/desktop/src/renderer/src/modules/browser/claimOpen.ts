import type { BrowserClaimOpenIntent, BrowserTabView } from "../../../../shared/browser";
import type { ModuleServices } from "../slots";
import { BROWSER_TAB, browserNavigationUrl, isBrowserTabKey } from "./browserState";

/** How long a claim tab keeps its pre-hold without a lease (main gives up after 20 s). */
export const CLAIM_OPEN_HOLD_MS = 25_000;

/**
 * Show main's new owner tab for a claim, held mounted so main can attach and grant it: in the requesting
 * agent's lane, else the host's. The key is main-reserved (owner provenance lives in main); this only
 * places the card. Without a lease after the deadline the pre-hold is dropped, the tab stays.
 */
export function openClaimTab(side: Pick<ModuleServices["side"], "openHeld" | "releaseHold">, hostId: string, epoch: string, intent: BrowserClaimOpenIntent,
  view: (hostId: string, tabKey: string) => BrowserTabView | undefined, setTimer: typeof setTimeout = setTimeout): boolean {
  const url = browserNavigationUrl(intent.url);
  if (!url || !isBrowserTabKey(intent.tabKey) || !/^[A-Za-z0-9._:-]{1,200}$/.test(intent.sessionId)) return false;
  const params = { url, tabKey: intent.tabKey, ownerTab: true };
  let opened = side.openHeld(BROWSER_TAB, params, { binding: { kind: "agent", hostId, sessionId: intent.sessionId }, hostEpoch: epoch });
  if (opened.status !== "opened") opened = side.openHeld(BROWSER_TAB, params, { binding: { kind: "host", hostId }, hostEpoch: epoch });
  if (opened.status !== "opened") return false;
  const hold = opened.hold;
  setTimer(() => { if (!view(hostId, intent.tabKey)?.lease) side.releaseHold(hold); }, CLAIM_OPEN_HOLD_MS);
  return true;
}
