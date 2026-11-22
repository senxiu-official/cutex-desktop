// Bounded agent-bus bootstrap (cutex capability `bootstrap-bounded-bus`). An ordinary page open asks
// for `bus=bounded`: cutex then sends every unresolved message plus the finished ones linked to the
// returned turns, not the whole history (an old Director's full list is ~11 MB). The finished
// messages of older turns come from `GET /v2/sessions/{id}/bus-messages?turnIds=…&itemIds=…` when the
// owner scrolls into those turns. Every page is merged by messageId into the agent-messages store; a
// message missing from a bounded read or a page says nothing about it (never closure). The settlement
// recovery reads (lib/messageSettlementWrites) and the steer checks keep the full bootstrap.
import type { BusMessagesDirection, BusMessagesPage } from "@cutex-desktop/protocol";

export { BOUNDED_BUS_FEATURE } from "../../../shared/boundedBus";

/** cutex accepts at most this many ids per filter set and this many rows per page. */
export const BUS_FILTER_MAX_IDS = 200;
export const BUS_PAGE_LIMIT = 200;
/** Pages read in one go (200 rows each); past it the rest waits for the owner's 继续读取. */
export const BUS_PAGE_BUDGET = 100;

export interface BusMessagesQuery {
  direction: BusMessagesDirection;
  cursor: string | null;
  turnIds: string[];
  itemIds: string[];
}

/** Whether a bootstrap was bounded (the host had more finished messages than it sent). */
export function boundedBusPage(page: { received?: { hasMore?: unknown } | null; sent?: { hasMore?: unknown } | null } | null | undefined): { received: boolean; sent: boolean } | null {
  if (!page) return null;
  return { received: page.received?.hasMore === true, sent: page.sent?.hasMore === true };
}

const rowId = (row: unknown): string | null => {
  const id = ((row ?? {}) as { messageId?: unknown }).messageId;
  return typeof id === "string" && id ? id : null;
};

/** cutex refuses ids over 512 bytes and filters over 16 KiB decoded; a set stays under this (commas included). */
export const BUS_FILTER_MAX_BYTES = 12 * 1024;
const BUS_ID_MAX_BYTES = 512;
const bytes = (id: string) => new TextEncoder().encode(id).length;

function chunks(turnIds: readonly string[], itemIds: readonly string[]): { turnIds: string[]; itemIds: string[] }[] {
  const out: { turnIds: string[]; itemIds: string[] }[] = [];
  let chunk = { turnIds: [] as string[], itemIds: [] as string[] };
  let size = 0;
  const add = (list: "turnIds" | "itemIds", id: string) => {
    const n = bytes(id);
    // cutex cannot filter by an id with a comma (the lists are comma-separated); such a turn stays unfilled.
    if (!n || n > BUS_ID_MAX_BYTES || id.includes(",")) return;
    if (chunk[list].length >= BUS_FILTER_MAX_IDS || size + n + 1 > BUS_FILTER_MAX_BYTES) {
      out.push(chunk);
      chunk = { turnIds: [], itemIds: [] };
      size = 0;
    }
    chunk[list].push(id);
    size += n + 1;
  };
  for (const id of turnIds) add("turnIds", id);
  for (const id of itemIds) add("itemIds", id);
  if (chunk.turnIds.length || chunk.itemIds.length) out.push(chunk);
  return out;
}

/** One filtered read still to do: a direction, one id set, and where its pages continue (null = first page). */
export interface BusHydrationTask {
  direction: BusMessagesDirection;
  turnIds: string[];
  itemIds: string[];
  cursor: string | null;
}

/** The reads of the bus messages linked to `turnIds` / `itemIds`, per direction and id set (≤ 200 ids, ≤ 12 KiB). */
export function busHydrationTasks(directions: readonly BusMessagesDirection[], turnIds: readonly string[], itemIds: readonly string[]): BusHydrationTask[] {
  const sets = chunks([...new Set(turnIds)], [...new Set(itemIds)]);
  return directions.flatMap((direction) => sets.map((set) => ({ direction, ...set, cursor: null })));
}

export interface BusHydrationResult {
  received: unknown[];
  sent: unknown[];
  /** Reads not finished — a failed read, a cursor that did not move, or the page budget — to retry or continue from. */
  rest: BusHydrationTask[];
}

/**
 * Read the tasks' pages (`turnIds`: received contextTurnId / sent senderTurnId; `itemIds`: received-message
 * item ids) until cutex has no more, at most `budget` pages in all. Every row is returned (the caller merges
 * them by messageId: delivery only moves forward, a closure stays, settlement evidence by observation time).
 * A failed read, a repeated cursor, or the budget ends the run: what is left comes back in `rest`, from the
 * page it stopped at, and nothing read is taken as closure of a message it did not return.
 */
export async function readLinkedBusMessages(
  read: (query: BusMessagesQuery) => Promise<BusMessagesPage>,
  tasks: readonly BusHydrationTask[],
  budget = BUS_PAGE_BUDGET,
): Promise<BusHydrationResult> {
  const out: BusHydrationResult = { received: [], sent: [], rest: [] };
  const seen = { received: new Set<string>(), sent: new Set<string>() };
  let pages = 0;
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]!;
    let cursor = task.cursor;
    const cursors = new Set<string>(cursor ? [cursor] : []);
    for (;;) {
      if (pages >= budget) {
        out.rest.push({ ...task, cursor }, ...tasks.slice(i + 1));
        return out;
      }
      pages++;
      let page: BusMessagesPage;
      try {
        page = await read({ direction: task.direction, cursor, turnIds: task.turnIds, itemIds: task.itemIds });
      } catch {
        out.rest.push({ ...task, cursor });
        break;
      }
      for (const row of page.messages) {
        const id = rowId(row);
        if (!id || seen[task.direction].has(id)) continue;
        seen[task.direction].add(id);
        out[task.direction].push(row);
      }
      const next = page.page.hasMore ? page.page.nextCursor : null;
      if (!next) break;
      // A cursor that does not move would read the same page forever: stop, keep the task to retry.
      if (cursors.has(next)) {
        out.rest.push({ ...task, cursor });
        break;
      }
      cursors.add(next);
      cursor = next;
    }
  }
  return out;
}

/** The turn ids and received-message item ids of `turns` (the filters of their linked bus messages). */
export function busLinksOf(turns: readonly { id: string; entryIds: readonly string[] }[], entries: { get(id: string): { kind: string; id: string } | undefined }): { turnIds: string[]; itemIds: string[] } {
  const turnIds: string[] = [];
  const itemIds: string[] = [];
  for (const turn of turns) {
    turnIds.push(turn.id);
    for (const id of turn.entryIds) if (entries.get(id)?.kind === "received") itemIds.push(id);
  }
  return { turnIds, itemIds };
}
