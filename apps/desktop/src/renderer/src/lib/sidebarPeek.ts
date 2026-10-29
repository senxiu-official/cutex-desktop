// The hidden sidebar's temporary pop-out (owner 2026-10-28): the pointer rests at the window's left edge or on
// the title-bar logo for PEEK_REST_MS and the sidebar pops over the content; PEEK_RETRACT_MS after the pointer
// leaves it (a context menu open holds it) it retracts. Pure timing, injectable for tests.

export const PEEK_REST_MS = 250;
export const PEEK_RETRACT_MS = 300;

export interface PeekSchedule { (fire: () => void, ms: number): () => void }
const defaultSchedule: PeekSchedule = (fire, ms) => {
  const timer = setTimeout(fire, ms);
  return () => clearTimeout(timer);
};

/** One armed delay: `enter` (re)starts it, `leave` cancels; when it runs out it fires `pop` once. */
export function createPeekRest(pop: () => void, ms: number = PEEK_REST_MS, schedule: PeekSchedule = defaultSchedule): { enter(): void; leave(): void } {
  let cancel: (() => void) | null = null;
  return {
    enter() {
      cancel?.();
      cancel = schedule(() => {
        cancel = null;
        pop();
      }, ms);
    },
    leave() {
      cancel?.();
      cancel = null;
    },
  };
}

/** The retract side: armed when the pointer leaves the popped sidebar, cancelled when it comes back. */
export function createPeekRetract(retract: () => void, ms: number = PEEK_RETRACT_MS, schedule: PeekSchedule = defaultSchedule): { arm(): void; stay(): void } {
  let cancel: (() => void) | null = null;
  return {
    arm() {
      cancel?.();
      cancel = schedule(() => {
        cancel = null;
        retract();
      }, ms);
    },
    stay() {
      cancel?.();
      cancel = null;
    },
  };
}
