// The Shelf a component draws (§24.13, two live workspaces): the focused conversation's live layout, or the
// other workspace's (lib/shelfSourceContext). The Shelf components read their layout through useShelfLayout; a
// press / focus inside the other workspace's Shelf (its panes, its rail, its instances) first gives that
// workspace the focus (focusPeer) — its Shelf becomes the live layout in the same place, the same instances
// (nothing moves, nothing remounts), so the press then acts on it like on any focused Shelf: keyboard shortcuts,
// Alt+1–9 and Esc always act on the focused workspace's Shelf.
import { useMemo } from "react";
import { parseConvKey } from "./convShelves";
import { conversationPanes, paneBinding } from "./paneLayout";
import { focusConversationPane, usePanes } from "./paneStore";
import { locate, type SideLayout, type SideViewContext } from "./sideLayout";
import { workspaceKeyFor } from "./sideComponents";
import { useApp } from "../store";
import { instanceOwner, liveConversation, peekConvView, peerView, setFocusedCard, useConvShelfVersion, useSide } from "./sideLayoutStore";
import { useShelfPeer, type ShelfPeer } from "./shelfSourceContext";

/** The layout of the Shelf being drawn (the live one, or the other workspace's as it shows). */
export function useShelfLayout(): SideLayout {
  const peer = useShelfPeer();
  const live = useSide((s) => s.layout);
  return peer ? peer.layout : live;
}

/**
 * The provider value for peer `key`'s Shelf. Before the store has made it a peer (the work row's first render
 * of a second workspace when nothing synced it yet: lib/sideLayoutStore syncPeers runs right after), its Shelf as
 * stored / remembered, so the row is laid out with it from the start.
 */
export function usePeerSource(key: string | null): ShelfPeer | null {
  const peer = useSide((s) => (key ? s.peers[key] : undefined));
  const live = useSide((s) => s.layout);
  const version = useConvShelfVersion((s) => s.n);
  const view = peer ? peerView(peer, live) : null;
  const k = key ? parseConvKey(key) : null;
  const fallback = useMemo(() => (!peer && key && liveConversation() !== key ? peekConvView(key) : null), [peer, key, version, live]); // eslint-disable-line react-hooks/exhaustive-deps
  const layout = view ?? fallback;
  return useMemo(() => (key && k && layout ? { key, hostId: k.hostId, sessionId: k.sessionId, layout } : null), [key, layout]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * The view context of a peer's Shelf, from the focused one (`base`: the same components, another conversation):
 * what the work row needs to lay the other workspace's Shelves out (null: no peer).
 */
export function usePeerViewContext(base: SideViewContext, peer: ShelfPeer | null): SideViewContext | null {
  const hostId = peer?.hostId ?? null;
  const sessionId = peer?.sessionId ?? null;
  const workspaceKey = useApp((s) => (hostId && sessionId ? workspaceKeyFor(s, hostId, sessionId) : null));
  return useMemo(() => (hostId && sessionId ? { ...base, hostId, sessionId, workspaceKey } : null), [base, hostId, sessionId, workspaceKey]);
}

/** The conversation pane showing conversation `key` (`convKey`), or null. */
export function paneOfConversation(key: string): string | null {
  const k = parseConvKey(key);
  if (!k) return null;
  const work = usePanes.getState().layout;
  return conversationPanes(work).find((id) => {
    const b = paneBinding(work, id);
    return b?.hostId === k.hostId && b.sessionId === k.sessionId;
  }) ?? null;
}

/**
 * A press / focus inside the other workspace's live Shelf: that workspace takes the focus first (synchronously:
 * by the time the press's own handler runs, its Shelf is the live layout). Nothing when it already has it.
 */
export function focusPeer(key: string): void {
  if (liveConversation() === key) return;
  const pane = paneOfConversation(key);
  if (pane) focusConversationPane(pane);
}

/**
 * A press inside instance `id` that never reached the window (design 017, the lead's default): a click in a web
 * page / service page (main's browser `pressed`) or in a frame (installFramePress) counts as a press in its pane
 * — its workspace takes the focus (focusPeer), its card becomes the focused one. Gone: nothing.
 */
export function pressInstance(id: string): void {
  const owner = instanceOwner(id);
  if (owner === undefined) return;
  if (owner) focusPeer(owner);
  const at = locate(useSide.getState().layout, id);
  if (at) setFocusedCard(at.card.id);
}

/** The side instance an element is in (its instance layer box, components/side/SideInstanceLayer). */
function instanceOf(el: Element | null): string | null {
  return el?.closest("[data-side-instance]")?.getAttribute("data-side-instance") ?? null;
}

/**
 * Presses inside the panes' frames (an agent page, a plugin: <iframe>): the frame swallows the press, the window
 * only sees its own `blur` with the frame as document.activeElement (no focus / pointer event on the frame, Chrome
 * checked) — and nothing at all when the focus goes from one frame straight into another, so while the focus is
 * in a frame document.activeElement is looked at every 200 ms. A <webview> is left out: the agent's own clicks
 * pull the focus into it too; main reports the owner's presses there (browser `pressed`). When the other
 * workspace takes the focus some other way while one of its frames keeps it, that frame is blurred so the next
 * press in it counts again. Returns the uninstall.
 */
export function installFramePress(win: Window = window): () => void {
  const doc = win.document;
  let last: Element | null = doc.activeElement;
  let timer: ReturnType<typeof setInterval> | null = null;
  const check = () => {
    const el = doc.activeElement;
    const inFrame = el?.tagName === "IFRAME" || el?.tagName === "WEBVIEW";
    if (el !== last) {
      last = el;
      const id = el?.tagName === "IFRAME" ? instanceOf(el) : null;
      if (id) pressInstance(id);
    }
    if (inFrame && !timer) timer = setInterval(check, 200);
    if (!inFrame && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
  let live = liveConversation();
  const offSide = useSide.subscribe(() => {
    if (liveConversation() === live) return;
    live = liveConversation();
    // After the change settles (lib/sideLayoutStore withLiveShelf swaps in and back out synchronously).
    queueMicrotask(() => {
      const el = doc.activeElement;
      const id = el?.tagName === "IFRAME" ? instanceOf(el) : null;
      if (id && instanceOwner(id)) (el as HTMLElement).blur();
    });
  });
  win.addEventListener("blur", check);
  win.addEventListener("focus", check);
  return () => {
    offSide();
    win.removeEventListener("blur", check);
    win.removeEventListener("focus", check);
    if (timer) clearInterval(timer);
  };
}
