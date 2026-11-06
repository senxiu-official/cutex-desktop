import type { BrowserPopupBlockReason } from "@cutex-desktop/browser-protocol";

/**
 * What became of a page's attempt to open a tab after the leased agent's click, per opener
 * guest. Main decides (window-open handler); this only remembers the decision for the click
 * result, never a renderer or agent flag.
 *
 * A target=_blank link opens within the provider's agent-input window, just after the click's
 * own receipt, so the answer normally waits at most AGENT_POPUP_WAIT_MS. A page that first asks
 * its server (XHR / fetch started after the click) and then calls window.open is past that
 * window, and main blocks it as a page popup. So while such a request is still running, or just
 * ended, the click result keeps watching until the page is quiet, at most AGENT_POPUP_SETTLE_MS.
 * Waiting changes no decision: a late popup stays blocked; the agent only hears about it.
 */
export const AGENT_POPUP_WAIT_MS = 200;
/** After the page's last request ends, how long a following window.open may take. */
export const AGENT_POPUP_QUIET_MS = 300;
export const AGENT_POPUP_SETTLE_MS = 3000;
export type AgentPopupOutcome = { opened: true } | { blocked: BrowserPopupBlockReason };
/** Main's popup discard reasons (network.ts / popupInput.ts) as the agent's fixed reasons. */
export function popupBlockReason(code: string): BrowserPopupBlockReason {
  switch (code) {
    case "no_owner_input": return "late_page_popup";
    case "rate_limited": case "agent_rate_limited": return "rate_limited";
    case "policy_denied": return "address_not_allowed";
    case "post_body": return "form_post";
    case "invalid_url": return "invalid_url";
    default: return "unavailable";
  }
}
interface Guest { event?: { at: number; outcome: AgentPopupOutcome }; requests: Map<string, number>; lastEnd: number; wake: Set<() => void> }

export class AgentPopups {
  readonly #guests = new Map<string, Guest>();
  constructor(private readonly now: () => number = Date.now, private readonly waitMs = AGENT_POPUP_WAIT_MS,
    private readonly quietMs = AGENT_POPUP_QUIET_MS, private readonly settleMs = AGENT_POPUP_SETTLE_MS) {}
  #guest(guestId: string): Guest {
    let guest = this.#guests.get(guestId);
    if (!guest) this.#guests.set(guestId, guest = { requests: new Map(), lastEnd: -Infinity, wake: new Set() });
    return guest;
  }
  #changed(guest: Guest): void { for (const wake of [...guest.wake]) wake(); }
  /** Main opened a tab for the agent's click in this guest. */
  note(guestId: string, at = this.now()): void { this.#record(guestId, at, { opened: true }); }
  /** Main blocked a page popup in this guest (reason: main's discard code). */
  blocked(guestId: string, code: string, at = this.now()): void { this.#record(guestId, at, { blocked: popupBlockReason(code) }); }
  #record(guestId: string, at: number, outcome: AgentPopupOutcome): void {
    const guest = this.#guest(guestId); guest.event = { at, outcome }; this.#changed(guest);
  }
  /** The page's own XHR / fetch (main's request observer; ids are Electron request ids). */
  requestStarted(guestId: string, id: string, at = this.now()): void {
    const guest = this.#guest(guestId);
    if (guest.requests.size < 256) guest.requests.set(id, at);
  }
  requestEnded(guestId: string, id: string, at = this.now()): void {
    const guest = this.#guests.get(guestId);
    if (!guest?.requests.delete(id)) return;
    guest.lastEnd = at; this.#changed(guest);
  }
  /** What a click that began at `since` led to, or undefined when the page opened nothing. */
  outcome(guestId: string, since: number): Promise<AgentPopupOutcome | undefined> {
    const guest = this.#guest(guestId), started = this.now();
    const decided = () => guest.event && guest.event.at >= since ? guest.event.outcome : undefined;
    // Still worth waiting: inside the first window, or the page is talking to its server since the click.
    const busy = (now: number) => now - started < this.waitMs
      || [...guest.requests.values()].some(at => at >= since) || (guest.lastEnd >= since && now - guest.lastEnd < this.quietMs);
    const settled = decided();
    if (settled) return Promise.resolve(settled);
    return new Promise(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (value: AgentPopupOutcome | undefined) => { if (timer) clearTimeout(timer); guest.wake.delete(check); resolve(value); };
      const check = () => {
        const value = decided(), now = this.now();
        if (value) return finish(value);
        if (now - started >= this.settleMs || !busy(now)) return finish(undefined);
        if (timer) clearTimeout(timer);
        timer = setTimeout(check, Math.min(50, this.settleMs - (now - started)));
      };
      guest.wake.add(check);
      check();
    });
  }
  forget(guestId: string): void {
    const guest = this.#guests.get(guestId); this.#guests.delete(guestId);
    if (guest) this.#changed(guest);
  }
}
