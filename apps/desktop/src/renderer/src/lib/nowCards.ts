// Sidebar layout B 「现在 / 全部」's upper half (design 040 §4 B, step 14): one card per agent that needs the owner
// (needs-you / failed; the 需要你 strip's chips, lib/agentAttention), longest waiting first, then the agents open in
// the conversation columns (marked 左 / 右 with two columns); at most NOW_MAX cards, the rest behind 「还有 N」.
// Stable order (owner principle): a card keeps its place until its own event changes — its `since` is when the
// current need (its fingerprint) was first seen, not a live timestamp. Pure; components/SidebarNowAll draws it.
import type { AttentionChip, NeedsYouReason } from "./agentAttention";

export const NOW_MAX = 5;

export type NowAction = "reply" | "answer" | "approve" | "open";

export interface NowCard {
  /** Row key (host + id in a multi-host list). */
  key: string;
  chip: AttentionChip | null;
  /** Open in a conversation column: which one with two side by side (null: one column, or not open). */
  column: "left" | "right" | null;
  open: boolean;
  action: NowAction | null;
}

/** What a need card's button says (it opens where that is done, as the card does). */
export function nowAction(chip: AttentionChip): NowAction {
  if (chip.signal !== "needsYou") return "open";
  const r: NeedsYouReason | null = chip.reason;
  if (r === "question") return "answer";
  if (r === "ownerMessage" || r === "ownerReply") return "reply";
  if (r === "approval" || r === "review" || r === "acceptance" || r === "confirm" || r === "safetyBlock") return "approve";
  return "open";
}

export interface SinceMemo {
  fp: string;
  since: number;
}

/**
 * Keys in a stable order: by when each one's current event was first seen (oldest first), then by key. `fp`: the
 * event's fingerprint (a new need = a new fingerprint = a new `since`); `at`: the event's own time if known (else now).
 * Returns the order and the memo to keep for the next call (entries that left are dropped).
 */
export function stableOrder(prev: ReadonlyMap<string, SinceMemo>, items: readonly { key: string; fp: string; at: number | null }[], now: number): { order: string[]; memo: Map<string, SinceMemo> } {
  const memo = new Map<string, SinceMemo>();
  for (const it of items) {
    const was = prev.get(it.key);
    memo.set(it.key, was && was.fp === it.fp ? was : { fp: it.fp, since: it.at ?? now });
  }
  const order = items.map((it) => it.key).sort((a, b) => memo.get(a)!.since - memo.get(b)!.since || (a < b ? -1 : a > b ? 1 : 0));
  return { order, memo };
}

/**
 * The cards: needs (in `needOrder`), then open agents that are not already a need card; `columns` = the row keys
 * of the conversation columns on screen, left to right. `max`: the cards shown; `rest` = the others.
 */
export function nowCards(needs: readonly AttentionChip[], needOrder: readonly string[], columns: readonly (string | null)[], max = NOW_MAX): { shown: NowCard[]; rest: NowCard[] } {
  const byKey = new Map(needs.map((c) => [c.key, c]));
  const columnOf = (key: string): NowCard["column"] => (columns.length < 2 ? null : columns[0] === key ? "left" : columns[columns.length - 1] === key ? "right" : null);
  const open = new Set(columns.filter((k): k is string => !!k));
  const list: NowCard[] = needOrder.flatMap((key) => {
    const chip = byKey.get(key);
    return chip ? [{ key, chip, column: columnOf(key), open: open.has(key), action: nowAction(chip) }] : [];
  });
  for (const key of columns) if (key && !byKey.has(key) && !list.some((c) => c.key === key)) list.push({ key, chip: null, column: columnOf(key), open: true, action: null });
  return { shown: list.slice(0, max), rest: list.slice(max) };
}
