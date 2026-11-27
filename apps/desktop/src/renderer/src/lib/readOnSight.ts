// Cross-device read state (design 061, owner 2026-11-26): a reply is read once it was actually seen — the newest
// finished reply of the agent, as the host's state names it, rendered at the visible end of a conversation the owner
// is looking at (window focused and visible, the conversation not folded, scrolled to its end, not an older page or a
// view still loading). Opening an agent and scrolling up is not reading it. Only on hosts with cross-device read state
// (lib/hostAttention); elsewhere the device-local marks keep their rules (lib/turnUnread).
import { useEffect, type RefObject } from "react";
import { isFoldedConversation } from "./foldedTest";
import { readReply, useHostAttention } from "./hostAttention";
import { resizeObserverFor } from "./ownerWindow";
import type { TimelineState } from "./timeline";

/** How long the reply has to stay on screen before it counts as seen. */
export const READ_DWELL_MS = 700;

/** The bit of a conversation view this needs (lib/store SessionView). */
export interface SightView {
  loading: boolean;
  resyncing: boolean;
  error: string | null;
  timeline: Pick<TimelineState, "turns">;
}

/**
 * Whether `turnId` is the reply the view ends with: the newest finished (completed / failed) turn of a loaded view,
 * with nothing after it but interrupted turns (they leave no reply to read). A turn still running after it: not yet
 * (its own end becomes the reply to read).
 */
export function endsWithReply(view: SightView | undefined, turnId: string): boolean {
  if (!view || view.loading || view.resyncing || view.error) return false;
  const turns = view.timeline.turns;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]!;
    if (turn.status === "interrupted") continue;
    return turn.id === turnId && (turn.status === "completed" || turn.status === "failed");
  }
  return false;
}

/** Whether the scroller shows the end of the conversation with `turnId`'s rows in it (laid out, on screen). */
export function tailShows(el: HTMLElement, turnId: string, stuck: boolean): boolean {
  if (!stuck || el.clientHeight === 0) return false;
  const anchor = el.querySelector(`[data-turn-id="${CSS.escape(turnId)}"]`);
  if (!anchor) return false;
  return anchor.getBoundingClientRect().top < el.getBoundingClientRect().bottom;
}

/**
 * Read the agent's newest reply when it is seen (see the header). `stuck`: the conversation follows its end (scrolled
 * to the bottom); `view`: its timeline.
 */
export function useReadOnSight(hostId: string, sessionId: string | null, scroller: RefObject<HTMLElement | null>, stuck: () => boolean, view: SightView | undefined): void {
  const state = useHostAttention(hostId);
  const agent = sessionId ? state?.agents.get(sessionId) : undefined;
  const turnId = agent && agent.unreadTurns > 0 ? (agent.latest?.turnId ?? null) : null;
  const ends = !!turnId && endsWithReply(view, turnId);
  useEffect(() => {
    const el = scroller.current;
    if (!ends || !sessionId || !turnId || !el) return;
    const doc = el.ownerDocument;
    const win = doc.defaultView;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const seen = () => doc.visibilityState === "visible" && doc.hasFocus() && !isFoldedConversation(hostId, sessionId) && tailShows(el, turnId, stuck());
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!seen()) return;
      timer = setTimeout(() => {
        timer = null;
        if (seen()) readReply(hostId, sessionId, turnId);
      }, READ_DWELL_MS);
    };
    arm();
    // Scrolling back to the end, the window getting the focus or coming back into view: look again.
    el.addEventListener("scroll", arm, { passive: true });
    win?.addEventListener("focus", arm);
    doc.addEventListener("visibilitychange", arm);
    // Unfolded, or laid out again (a pane shown, the window resized).
    const resize = resizeObserverFor(el, arm);
    resize?.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      resize?.disconnect();
      el.removeEventListener("scroll", arm);
      win?.removeEventListener("focus", arm);
      doc.removeEventListener("visibilitychange", arm);
    };
  }, [ends, hostId, sessionId, turnId, scroller, stuck]);
}
