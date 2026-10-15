// Jump to a turn or a delegation card in an agent's timeline (focusTurn / focusDelegation): select
// the agent, then the conversation's TimelineBody widens its turn window until the target is
// rendered, lets go of stick-to-bottom, scrolls it into view and flashes it. Only turns already
// loaded are searched here; services.timeline.focusTurn (lib/jump.ts) pages older history in first
// and keeps the 「回到」 point. A miss says so (or goes to `onDone` when the requester reports it).
import { create } from "zustand";
import { useApp } from "../store";

export interface FocusRequest {
  sessionId: string;
  turnId?: string;
  askId?: string;
  /** An owner-notify message card (lib/ownerNotifyStore focusOwnerNote). */
  notificationId?: string;
  nonce: number;
  /** Instead of scroll-to-centre + flash (lib/jump.ts: restoring a reading position). */
  land?(el: Element): void;
  /** The requester reports the result itself (no 「not loaded」 notice from the timeline). */
  onDone?(found: boolean): void;
}

export const useFocusRequest = create<{ request: FocusRequest | null }>(() => ({ request: null }));

/** `hostId`: the agent's host (default: `select`'s — the open agent's when it is the same id, else the focus host). */
export function focusTurn(sessionId: string, turnId: string, hostId?: string): void {
  useFocusRequest.setState({ request: { sessionId, turnId, nonce: Date.now() + Math.random() } });
  void (hostId ? useApp.getState().openAgent(sessionId, hostId) : useApp.getState().select(sessionId));
}

/** The requester's `agent_delegate` card of a delegation. */
export function focusDelegation(sessionId: string, askId: string, hostId?: string): void {
  useFocusRequest.setState({ request: { sessionId, askId, nonce: Date.now() + Math.random() } });
  void (hostId ? useApp.getState().openAgent(sessionId, hostId) : useApp.getState().select(sessionId));
}

export function clearFocusRequest(nonce: number): void {
  if (useFocusRequest.getState().request?.nonce === nonce) useFocusRequest.setState({ request: null });
}

const FLASH = ["ring-2", "ring-accent/60", "ring-offset-2", "ring-offset-background", "rounded-lg"];
const FLASH_MS = 1800;

/** Scroll an element into view and highlight it briefly. */
export function flashElement(el: Element): void {
  el.scrollIntoView({ block: "center" });
  el.classList.add(...FLASH);
  setTimeout(() => el.classList.remove(...FLASH), FLASH_MS);
}
