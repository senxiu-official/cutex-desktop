// The energy pool (pure, test/deskPetBooks.test.ts; docs/desktop-modules.md §29.10): the tokens agents used, waiting to
// be worked off by a format 2 pet. Credits come from the same count as the number under the pet (non-cached input +
// output; ./today), through a cursor per host and day, so a replayed report, a reconnect or a recalibrated ledger never
// counts twice. The pool is books: each holds up to `units × tokensPerBook`; new tokens fill the newest book on top of
// the pile, then new books land on it. While the pet is shown it works the pool off at `tokensPerMinute`: the book in
// hand is read down, a finished one is put away and the next comes off the top. Nothing is free: no refill, no daily
// pile. The real balance is unbounded; only the top `max` books are kept as items, the rest are a token count below.
// The window only draws this state, so no animation can change a count.
import type { DeskPetBookArt } from "../../../../shared/deskPet";

export interface PoolConfig {
  /** Tokens one book (of 1 unit) holds. */
  tokensPerBook: number;
  /** How fast the pet works the pool off while it is shown. */
  tokensPerMinute: number;
}
export const DEFAULT_POOL: PoolConfig = { tokensPerBook: 50_000, tokensPerMinute: 50_000 };
export const POOL_BOOK_CHOICES: readonly number[] = [10_000, 20_000, 50_000, 100_000, 200_000, 500_000];
export const POOL_SPEED_CHOICES: readonly number[] = [10_000, 25_000, 50_000, 100_000, 250_000, 1_000_000];

export interface BookItem { id: string; cover: string; kind: string; units: number; tokens: number }

export interface PoolState {
  /** The art the books were made for (pile size, deck); other art keeps the balance and makes new books. */
  art: string;
  /** Numbers new books. */
  seq: number;
  active: { book: BookItem; left: number } | null;
  /** The top of the pile as items, lowest first, at most the art's `max`. */
  pile: BookItem[];
  /** Tokens in books below the shown part of the pile. */
  below: number;
  /** Credits so far, per host, for one local day: what the number under the pet had reached. */
  cursor: { day: string; hosts: Record<string, number> };
  /** The consumption clock: worked off up to here (ms). */
  at: number;
  /** Today (the cursor's day): tokens worked off and books finished. */
  worked: number;
  done: number;
}

export type BookEvent =
  | { type: "book-started"; book: BookItem; pending: number }
  | { type: "book-completed"; book: BookItem; pending: number }
  | { type: "pile-empty" };

export const artKeyOf = (art: DeskPetBookArt) => JSON.stringify([art.max, art.deck]);

export const emptyPool = (art: DeskPetBookArt, day: string, now: number): PoolState => ({ art: artKeyOf(art), seq: 0, active: null, pile: [], below: 0, cursor: { day, hosts: {} }, at: now, worked: 0, done: 0 });

/** Every token not yet worked off. */
export function pendingOf(s: PoolState): number {
  return (s.active?.left ?? 0) + s.pile.reduce((n, b) => n + b.tokens, 0) + s.below;
}
/** Books, the one in hand included; the part below the shown pile counted in whole books of 1 unit. */
export function booksOf(s: PoolState, config: PoolConfig): number {
  return (s.active ? 1 : 0) + s.pile.length + Math.ceil(s.below / config.tokensPerBook);
}

function capOf(b: Pick<BookItem, "units">, config: PoolConfig): number {
  return b.units * config.tokensPerBook;
}
function mint(s: PoolState, art: DeskPetBookArt): BookItem {
  const d = art.deck[s.seq % art.deck.length]!;
  s.seq++;
  return { id: `book-${s.seq}`, cover: d.cover, kind: d.kind, units: d.units, tokens: 0 };
}
/** Keeps at most `max` items: the lowest go below the shown part; and fills the shown part back from below. */
function settle(s: PoolState, art: DeskPetBookArt, config: PoolConfig): void {
  while (s.pile.length > art.max) s.below += s.pile.shift()!.tokens;
  while (s.pile.length < art.max && s.below > 0) {
    const b = mint(s, art);
    b.tokens = Math.min(capOf(b, config), s.below);
    s.below -= b.tokens;
    s.pile.unshift(b);
  }
}

/** The day moved on: a new cursor (today's counts start at 0 again); the balance stays. */
function onDay(s: PoolState, day: string): void {
  if (s.cursor.day === day) return;
  s.cursor = { day, hosts: {} };
  s.worked = 0;
  s.done = 0;
}

/**
 * The number under the pet per host (`totals`, for `day`): what grew past the cursor is credited, once. A count that
 * falls (a reconnect waiting for its ledger) credits nothing, and nothing again until it is back above where it was.
 */
export function creditPool(state: PoolState, day: string, totals: Readonly<Record<string, number>>, art: DeskPetBookArt, config: PoolConfig): { state: PoolState; added: number } {
  const s: PoolState = { ...state, pile: state.pile.map((b) => ({ ...b })), cursor: { day: state.cursor.day, hosts: { ...state.cursor.hosts } } };
  onDay(s, day);
  let added = 0;
  for (const [host, total] of Object.entries(totals)) {
    const before = s.cursor.hosts[host] ?? 0;
    if (total > before) {
      added += total - before;
      s.cursor.hosts[host] = total;
    }
  }
  if (added <= 0) return { state: added === 0 && s.cursor.day === state.cursor.day ? state : s, added: 0 };
  let left = added;
  // The newest book on top first, then new books land on it.
  const top = s.pile.at(-1);
  if (top && top.tokens < capOf(top, config)) {
    const put = Math.min(left, capOf(top, config) - top.tokens);
    top.tokens += put;
    left -= put;
  }
  while (left > 0) {
    const b = mint(s, art);
    b.tokens = Math.min(capOf(b, config), left);
    left -= b.tokens;
    s.pile.push(b);
    // Beyond the shown part, the lowest go below: only the top `max` are items, whatever the burst.
    if (s.pile.length > art.max) s.below += s.pile.shift()!.tokens;
  }
  settle(s, art, config);
  return { state: s, added };
}

/** Works the pool off up to `now` while `working` (the pet is shown); else only moves the clock. */
export function workPool(state: PoolState, now: number, working: boolean, art: DeskPetBookArt, config: PoolConfig): { state: PoolState; events: BookEvent[] } {
  // Nothing to read down yet: only the clock moves. Work starting takes the top book at once, even at the same instant.
  if (!working || now < state.at || (now === state.at && (state.active || (!state.pile.length && state.below <= 0)))) return { state: now <= state.at ? state : { ...state, at: now }, events: [] };
  const s: PoolState = { ...state, pile: [...state.pile], active: state.active && { ...state.active }, at: now };
  const events: BookEvent[] = [];
  let budget = ((now - state.at) / 60_000) * config.tokensPerMinute;
  for (;;) {
    if (!s.active) {
      settle(s, art, config);
      const book = s.pile.pop();
      if (!book) {
        if (state.active || state.pile.length) events.push({ type: "pile-empty" });
        break;
      }
      settle(s, art, config);
      s.active = { book, left: book.tokens };
      events.push({ type: "book-started", book, pending: pendingOf(s) });
    }
    const use = Math.min(budget, s.active.left);
    s.active.left -= use;
    s.worked += use;
    budget -= use;
    if (s.active.left > 1e-6) break;
    s.done++;
    const finished = s.active.book;
    s.active = null;
    events.push({ type: "book-completed", book: finished, pending: pendingOf(s) });
    if (budget <= 0 && !s.pile.length && s.below <= 0) {
      events.push({ type: "pile-empty" });
      break;
    }
  }
  return { state: s, events };
}

/** When the book in hand runs out at this speed (ms); null = nothing in hand. */
export function nextBookEnd(s: PoolState, config: PoolConfig): number | null {
  return s.active ? s.at + (s.active.left / config.tokensPerMinute) * 60_000 : null;
}

/** Other art (pile size or deck): the balance stays, the books are made again for the new art. */
export function refitPool(state: PoolState, art: DeskPetBookArt, config: PoolConfig): PoolState {
  if (state.art === artKeyOf(art)) return state;
  const s: PoolState = { ...state, art: artKeyOf(art), pile: [], below: pendingOf(state) - (state.active?.left ?? 0) };
  settle(s, art, config);
  return s;
}

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
function parseBook(raw: unknown): BookItem | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(b.id)) return null;
  if (typeof b.cover !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(b.cover) || typeof b.kind !== "string" || b.kind.length > 32) return null;
  if (!isCount(b.units) || !Number.isInteger(b.units) || b.units < 1 || !isCount(b.tokens)) return null;
  return { id: b.id, cover: b.cover, kind: b.kind, units: b.units, tokens: b.tokens };
}

/** A stored pool; null = unusable (then an empty one). The clock restarts at `now`: nothing is worked off while closed. */
export function parsePool(raw: unknown, now: number): PoolState | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.art !== "string" || !isCount(s.seq) || !isCount(s.below) || !isCount(s.worked) || !isCount(s.done)) return null;
  if (!Array.isArray(s.pile) || s.pile.length > 20) return null;
  const pile = s.pile.map(parseBook);
  if (pile.some((b) => !b)) return null;
  let active: PoolState["active"] = null;
  if (s.active !== null) {
    const a = s.active as Record<string, unknown> | undefined;
    const book = parseBook(a?.book);
    if (!book || !isCount(a?.left)) return null;
    active = { book, left: a.left as number };
  }
  const c = s.cursor as Record<string, unknown> | undefined;
  if (!c || typeof c.day !== "string" || !c.hosts || typeof c.hosts !== "object") return null;
  const hosts: Record<string, number> = {};
  for (const [k, v] of Object.entries(c.hosts as Record<string, unknown>)) {
    if (!isCount(v)) return null;
    hosts[k] = v;
  }
  return { art: s.art, seq: s.seq, active, pile: pile as BookItem[], below: s.below, cursor: { day: c.day, hosts }, at: now, worked: s.worked, done: s.done };
}

export function parsePoolConfig(raw: unknown): PoolConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    tokensPerBook: POOL_BOOK_CHOICES.includes(r.tokensPerBook as number) ? (r.tokensPerBook as number) : DEFAULT_POOL.tokensPerBook,
    tokensPerMinute: POOL_SPEED_CHOICES.includes(r.tokensPerMinute as number) ? (r.tokensPerMinute as number) : DEFAULT_POOL.tokensPerMinute,
  };
}
