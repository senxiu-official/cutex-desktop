import type { TimelineEntry, TimelineState, TurnView } from "./timeline";

/** Derived indexes only: Map remains the authoritative native entry collection. All writers,
 * including history prepend and live text repair, already use set/delete/clear. */
export class TimelineEntries extends Map<string, TimelineEntry> {
  private revisions = new Map<string, number>();
  private counts = new Map<string, number>();
  private users = new Map<string, Set<string>>();
  private sequence = 0;

  constructor(entries?: Iterable<readonly [string, TimelineEntry]>) {
    super();
    if (entries) for (const [id, entry] of entries) this.set(id, entry);
  }

  revision(turnId: string): number { return this.revisions.get(turnId) ?? 0; }

  private remove(entry: TimelineEntry): void {
    if (entry.turnId) {
      const count = (this.counts.get(entry.turnId) ?? 1) - 1;
      if (count) {
        this.counts.set(entry.turnId, count);
        this.revisions.set(entry.turnId, ++this.sequence);
      } else {
        this.counts.delete(entry.turnId);
        this.revisions.delete(entry.turnId);
      }
    }
    if (entry.kind !== "user" || !entry.clientId) return;
    const ids = this.users.get(entry.clientId);
    ids?.delete(entry.id);
    if (!ids?.size) this.users.delete(entry.clientId);
  }

  override set(id: string, entry: TimelineEntry): this {
    const previous = super.get(id);
    // Also invalidate when a caller mutates an object and sets it again.
    if (previous) this.remove(previous);
    super.set(id, entry);
    if (entry.turnId) {
      this.counts.set(entry.turnId, (this.counts.get(entry.turnId) ?? 0) + 1);
      this.revisions.set(entry.turnId, ++this.sequence);
    }
    if (entry.kind === "user" && entry.clientId) {
      let ids = this.users.get(entry.clientId);
      if (!ids) this.users.set(entry.clientId, ids = new Set());
      ids.add(id);
    }
    return this;
  }

  override delete(id: string): boolean {
    const previous = super.get(id);
    if (!previous) return false;
    this.remove(previous);
    return super.delete(id);
  }

  override clear(): void {
    super.clear();
    this.revisions.clear();
    this.counts.clear();
    this.users.clear();
    // sequence never resets: clear + refill cannot reuse a cached turn revision.
  }

  userIds(clientId: string): Iterable<string> { return this.users.get(clientId) ?? []; }
}

/** Native identities relevant to ledger joins/drafts/outbox, including owner client ids that
 * differ from item ids. No full transcript scan on normal indexed timelines. Plain Maps from
 * external callers remain supported. */
export function timelineIdentityEntries(state: TimelineState, ids: Iterable<string>, turns: ReadonlyMap<string, TurnView> = new Map(state.turns.map(turn => [turn.id, turn]))): TimelineEntry[] {
  const entries = state.entries;
  const wanted = new Set(ids);
  const found = new Map<string, TimelineEntry>();
  for (const id of wanted) {
    const entry = entries.get(id);
    if (entry) found.set(entry.id, entry);
    if (entries instanceof TimelineEntries) for (const itemId of entries.userIds(id)) {
      const user = entries.get(itemId);
      if (user) found.set(user.id, user);
    }
  }
  if (!(entries instanceof TimelineEntries) && wanted.size) for (const entry of entries.values()) {
    if (entry.kind === "user" && entry.clientId && wanted.has(entry.clientId)) found.set(entry.id, entry);
  }
  // Map may also contain unbound/orphan entries. Match orderedEntries membership exactly.
  return [...found.values()].filter(entry => !!entry.turnId && !!turns.get(entry.turnId)?.entryIds.includes(entry.id));
}

/** Stable join inputs let delivery placement skip unrelated live text updates. */
export function createTimelineIdentityEntries() {
  let previous: TimelineEntry[] = [];
  const turnIndex = createTimelineTurnIndex();
  return (state: TimelineState, ids: Iterable<string>, turns?: ReadonlyMap<string, TurnView>) => {
    const wanted = [...ids];
    const next = wanted.length ? timelineIdentityEntries(state, wanted, turns ?? turnIndex(state.turns)) : [];
    if (next.length === previous.length && next.every((entry, index) => entry === previous[index])) return previous;
    previous = next;
    return next;
  };
}

/** Loaded-turn membership. Appends and prepended pages extend only the added range; replacements
 * and reverts rebuild, releasing removed turns. No hidden-turn traversal on live text or new turns. */
export function createTimelineTurnIndex() {
  let previous: TurnView[] | undefined;
  let length = 0;
  let first: TurnView | undefined;
  let last: TurnView | undefined;
  let index = new Map<string, TurnView>();
  return (turns: TurnView[]): ReadonlyMap<string, TurnView> => {
    const size = turns.length;
    if (turns === previous && size === length && turns[0] === first && turns[size - 1] === last) return index;
    const added = size - length;
    if (length && added > 0 && turns[0] === first && turns[length - 1] === last) {
      for (let i = length; i < size; i++) index.set(turns[i]!.id, turns[i]!);
    } else if (length && added > 0 && turns[added] === first && turns[size - 1] === last) {
      for (let i = 0; i < added; i++) index.set(turns[i]!.id, turns[i]!);
    } else index = new Map(turns.map(turn => [turn.id, turn]));
    previous = turns;
    length = size;
    first = turns[0];
    last = turns[size - 1];
    return index;
  };
}
