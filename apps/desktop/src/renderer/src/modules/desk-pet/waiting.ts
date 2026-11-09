// The waiting mark (pure, test/deskPetEnergy.test.ts): up while something waits on the owner whose agent they have not
// had in front of them since it began waiting. Opening the agent (on screen in a visible window) clears its items; a new
// question, approval or message is a new item and raises the mark again. Agent ↔ agent traffic never reaches here
// (lib/ownerWaiting).
import type { OwnerWaitingItem } from "../../lib/ownerWaiting";

export interface Marked {
  /** Items the owner has had on screen; only items still waiting are kept. */
  seen: ReadonlySet<string>;
  shown: boolean;
}

export function markOf(items: readonly OwnerWaitingItem[], seen: ReadonlySet<string>): Marked {
  const next = new Set<string>();
  for (const item of items) if (item.onScreen || seen.has(item.key)) next.add(item.key);
  return { seen: next, shown: items.some((i) => !next.has(i.key)) };
}

/** Rising icons: at most one per `gapMs`. */
export const ICON_GAP_MS = 400;
export const iconAllowed = (lastAt: number | null, now: number, gapMs = ICON_GAP_MS) => lastAt === null || now - lastAt >= gapMs;
