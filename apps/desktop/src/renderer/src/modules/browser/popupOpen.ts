// A web page's popup (target=_blank / window.open in a tab's guest; main minted the new tab, event `new-tab`):
// the new tab opens in the Shelf that holds the opener tab (docs/design/017-open-in-own-shelf.md) — the other
// workspace's too, the focus stays. The press that made it happened inside the guest, so no press reached the
// window to give that workspace the focus first (lib/shelfSource focusPeer). Opener gone: the focused Shelf.
// Also main's other events about a tab that can sit in either workspace's Shelf: `pressed` (the owner pressed in
// its page: a press in its pane, lib/shelfSource pressInstance) and `reveal` (bring it forward where it is).
// Multi-window P5: a tab can be drawn in a desk window; each of these events acts in the window that holds the
// tab (inBrowserTabWindow), so a popup opens next to its opener there, not in the window the owner works in.
import type { BrowserEvent } from "../../../../shared/browser";
import type { SideInstanceInfo, SideOpen, SideOpenResult, SideRevealResult, SideRevealTarget } from "../slots";
import type { Json } from "../types";
import { findInstanceAnywhere, instanceOwner, useSide, withLiveShelf } from "../../lib/sideLayoutStore";
import { currentWindow, inWindow } from "../../lib/windowScope";
import { pressInstance } from "../../lib/shelfSource";
import { opensElsewhere, sideOpenFrom } from "../../lib/shelfTarget";
import { BROWSER_TAB, browserNavigationUrl, isBrowserTabKey } from "./browserState";

type PopupEvent = Pick<BrowserEvent, "hostId" | "tabKey" | "pool" | "newTabUrl" | "newTabKey">;

/** The side instance of host `hostId`'s browser tab `tabKey`, in any live Shelf. `bound`: host- / agent-bound only. */
export function browserTabInstance(hostId: string, tabKey: string, bound = false): string | null {
  return findInstanceAnywhere((inst) => {
    const st = inst.state;
    return inst.kind === BROWSER_TAB && inst.binding.hostId === hostId && !!st && typeof st === "object" && !Array.isArray(st) && st.tabKey === tabKey
      && (!bound || inst.binding.kind === "host" || inst.binding.kind === "agent");
  });
}

/**
 * Runs `fn` in the app window (the main one or a desk, lib/windowScope) whose Shelves hold host `hostId`'s tab
 * `tabKey` — the current window first; held nowhere (or no key): in the current window.
 */
export function inBrowserTabWindow<T>(hostId: string, tabKey: string | undefined, fn: () => T): T {
  if (tabKey) {
    const here = currentWindow();
    for (const key of [here, ...useSide.windows().filter((k) => k !== here)]) {
      if (inWindow(key, () => browserTabInstance(hostId, tabKey))) return inWindow(key, fn);
    }
  }
  return fn();
}

/** main's `pressed`: the owner pressed in the tab's page — a press in its pane (its workspace takes the focus). */
export function pressBrowserTab(event: Pick<BrowserEvent, "hostId" | "tabKey">): void {
  const id = event.tabKey ? browserTabInstance(event.hostId, event.tabKey) : null;
  if (id) pressInstance(id);
}

/**
 * main's `reveal` (an agent acts on a tab that is not in view): this existing host- / agent-bound instance comes
 * forward where it is. In the focused Shelf through the module's own services (`side`, as before); else in the other
 * workspace's live Shelf, with the focus left where it is (design 017; that Shelf unfolds: the agent needs the page
 * on screen). Never opens a replacement. Null: no such instance.
 */
export function revealBrowserTab(event: Pick<BrowserEvent, "hostId" | "tabKey">, side: { list(kind: string): readonly SideInstanceInfo<Json>[]; reveal(target: SideRevealTarget): SideRevealResult }): SideRevealResult | null {
  // list() is the focused Shelf (the current scope).
  const here = side.list(BROWSER_TAB).find((instance) => instance.state && typeof instance.state === "object" && !Array.isArray(instance.state) && instance.state.tabKey === event.tabKey
    && (instance.binding.kind === "host" || instance.binding.kind === "agent") && instance.binding.hostId === event.hostId);
  if (here) return side.reveal({ instanceId: here.id });
  const id = event.tabKey ? browserTabInstance(event.hostId, event.tabKey, true) : null;
  const owner = id ? instanceOwner(id) : null;
  return id && owner ? withLiveShelf(owner, () => side.reveal({ instanceId: id })) : null;
}

/**
 * Opens a popup's new tab (null: not an http(s) URL / an agent-pool tab without its minted key). `open`: the
 * module's services.side.open, used when the opener is in the focused Shelf (or gone).
 */
export function openPopupTab(event: PopupEvent, open: SideOpen): SideOpenResult | null {
  const url = browserNavigationUrl(event.newTabUrl);
  if (!url || !/^https?:/.test(url) || (event.pool === "agent" && !isBrowserTabKey(event.newTabKey))) return null;
  // Main minted the new tab's key in the opener's pool (and holds the exact URL / form body for it).
  const params: Record<string, string | boolean> = event.pool === "agent" ? { url, tabKey: event.newTabKey!, agentOpened: true }
    : isBrowserTabKey(event.newTabKey) ? { url, tabKey: event.newTabKey, ownerTab: true } : { url };
  const opener = event.tabKey ? browserTabInstance(event.hostId, event.tabKey) : null;
  const source = opener ? { instanceId: opener } : null;
  const opts = { binding: { kind: "host" as const, hostId: event.hostId }, focus: false };
  return opensElsewhere(source) ? sideOpenFrom(source, BROWSER_TAB, params, opts) : open(BROWSER_TAB, params, opts);
}
