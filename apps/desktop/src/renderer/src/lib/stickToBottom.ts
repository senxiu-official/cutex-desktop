// Stick-to-bottom for the conversation timeline (components/Conversation.tsx): the pure rules plus
// the composer's "I just sent" signal. Pure apart from the tiny listener set.

/** Within this many px of the bottom counts as "at the bottom". */
export const STICK_THRESHOLD = 48;

export interface ScrollSample {
  top: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * What one scroll event means for following the bottom. `prev`: the scroller at the previous scroll
 * event (null before the first one).
 *
 * Only the owner scrolling UP lets go. A scroll that did not move up while following — the browser's
 * own adjustment (scroll anchoring, clamping) in the frame where new rows landed, before the
 * ResizeObserver could snap, or the viewport changing size — keeps following and snaps back to the
 * bottom (`snap`). Without this, a fresh user bubble (taller than the threshold on its own) made such
 * a scroll read as "scrolled away", and the timeline stopped following right after a send.
 */
export function scrollFollow(stick: boolean, prev: { top: number; clientHeight: number } | null, now: ScrollSample): { stick: boolean; snap: boolean } {
  const gap = now.scrollHeight - now.top - now.clientHeight;
  if (gap < STICK_THRESHOLD) return { stick: true, snap: false };
  if (stick && (!prev || now.clientHeight !== prev.clientHeight || now.top >= prev.top - 1)) return { stick: true, snap: true };
  return { stick: false, snap: false };
}

type FollowListener = (sessionId: string) => void;
const listeners = new Set<FollowListener>();

/** The owner sent from the composer: the agent's timeline goes (back) to the bottom and follows. */
export function followAfterSend(sessionId: string): void {
  for (const fn of [...listeners]) fn(sessionId);
}

/** The conversation listens for sends; returns the unsubscribe. */
export function onFollowAfterSend(fn: FollowListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * The pending sends that sit in (or move into) the timeline, as a string for a zustand selector:
 * when it changes, the conversation follows in its layout effect like it does for new entries — the
 * optimistic bubble is outbox state, not a timeline entry.
 */
export function pendingFollowKey(list: readonly { id: string; placement: string; state?: string }[] | undefined): string {
  return (list ?? []).map((e) => `${e.id}:${e.placement}:${e.state ?? ""}`).join("\n");
}
