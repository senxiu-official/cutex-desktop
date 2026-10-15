// Which timeline entries get the action row (复制 · 引用 · 分叉 · 回退到这里) and what revert /
// fork target each one has. Pure (no React) so it is unit-testable.
import type { TimelineEntry, TurnView } from "./timeline";

export interface ReplyBar {
  /** The turn this reply ends; fork continues after it. */
  turnId: string;
  /** Text copied / quoted (this reply's final message). */
  text: string;
  /** The turn right after this one: "回退到这里" reverts from there on. null = nothing after it. */
  nextTurnId: string | null;
  /** How many turns a revert to here drops. */
  laterTurns: number;
  /** The newest reply: its row is always visible (older rows show on hover). */
  latest: boolean;
}

/**
 * The last agent message of every finished turn, keyed by entry id. A running turn (or a message
 * still streaming) gets no row until it is done.
 */
export function replyBars(turns: readonly TurnView[], entries: readonly TimelineEntry[]): Map<string, ReplyBar> {
  const lastAgent = new Map<string, TimelineEntry & { kind: "agent" }>();
  for (const e of entries) if (e.kind === "agent" && e.turnId) lastAgent.set(e.turnId, e);
  const out = new Map<string, ReplyBar>();
  let newest: string | null = null;
  let newestIndex = -1;
  turns.forEach((turn, i) => {
    const entry = lastAgent.get(turn.id);
    if (!entry || entry.streaming || turn.status === "inProgress") return;
    out.set(entry.id, { turnId: turn.id, text: entry.text, nextTurnId: turns[i + 1]?.id ?? null, laterTurns: turns.length - i - 1, latest: false });
    if (i > newestIndex) {
      newestIndex = i;
      newest = entry.id;
    }
  });
  if (newest) out.get(newest)!.latest = true;
  return out;
}

/** How many turns reverting from `turnId` (inclusive) drops; 0 when unknown. */
export function turnsFrom(turns: readonly TurnView[], turnId: string): number {
  const i = turns.findIndex((t) => t.id === turnId);
  return i < 0 ? 0 : turns.length - i;
}
