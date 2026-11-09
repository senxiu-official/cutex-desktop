// The energy pool (modules/desk-pet/books.ts; docs/desktop-modules.md §29.10): tokens agents used, credited once from
// the per-host today count, worked off while the pet is shown, shown as at most `max` books; nothing is free.
import { describe, expect, it } from "vitest";
import { booksOf, creditPool, emptyPool, nextBookEnd, parsePool, parsePoolConfig, pendingOf, refitPool, workPool, type PoolConfig, type PoolState } from "../src/renderer/src/modules/desk-pet/books";

const ART = { max: 5, deck: [{ cover: "green", kind: "book", units: 1 }, { cover: "night", kind: "diary", units: 2 }] };
const CFG: PoolConfig = { tokensPerBook: 1000, tokensPerMinute: 1000 };
const DAY = "2026-11-09";
const credit = (s: PoolState, totals: Record<string, number>, day = DAY) => creditPool(s, day, totals, ART, CFG).state;
const work = (s: PoolState, now: number, shown = true) => workPool(s, now, shown, ART, CFG);

describe("desk pet energy pool", () => {
  it("starts empty: no books, nothing free, no work", () => {
    const s = emptyPool(ART, DAY, 0);
    expect(pendingOf(s)).toBe(0);
    expect(booksOf(s, CFG)).toBe(0);
    const w = work(s, 3_600_000);
    expect(w.state.active).toBeNull();
    expect(w.events).toEqual([]);
  });

  it("credits only what each host's count grew past its cursor: replay, a drop on reconnect and recalibration never count twice", () => {
    let s = credit(emptyPool(ART, DAY, 0), { a: 1500 });
    expect(pendingOf(s)).toBe(1500);
    s = credit(s, { a: 1500 });
    expect(pendingOf(s)).toBe(1500);
    // Reconnected: the live part is gone until the ledger answers; then the ledger has it all, and a little more.
    s = credit(s, { a: 200 });
    expect(pendingOf(s)).toBe(1500);
    s = credit(s, { a: 1600, b: 400 });
    expect(pendingOf(s)).toBe(2000);
    // A new day: the counts start from 0 again; the balance stays.
    s = credit(s, { a: 300 }, "2026-11-10");
    expect(pendingOf(s)).toBe(2300);
    expect(s.cursor).toEqual({ day: "2026-11-10", hosts: { a: 300 } });
  });

  it("new tokens fill the newest book on top, then new books land on it; covers and thickness follow the deck", () => {
    let s = credit(emptyPool(ART, DAY, 0), { a: 500 });
    expect(s.pile.map((b) => [b.id, b.cover, b.tokens])).toEqual([["book-1", "green", 500]]);
    s = credit(s, { a: 3000 });
    // book-1 filled to 1000, then book-2, a 2-unit diary, holds the other 2000.
    expect(s.pile.map((b) => [b.id, b.cover, b.tokens])).toEqual([["book-1", "green", 1000], ["book-2", "night", 2000]]);
    expect(pendingOf(s)).toBe(3000);
  });

  it("an unbounded balance: only the top `max` books are items, the rest stays counted below and comes back as the pile goes down", () => {
    let s = credit(emptyPool(ART, DAY, 0), { a: 1_000_000 });
    expect(pendingOf(s)).toBe(1_000_000);
    expect(s.pile).toHaveLength(5);
    expect(s.below).toBeGreaterThan(990_000);
    expect(booksOf(s, CFG)).toBeGreaterThan(900);
    const w = work(s, 60_000);
    expect(w.state.pile).toHaveLength(5);
    expect(pendingOf(w.state)).toBeCloseTo(999_000);
  });

  it("works the pool off only while shown, at the set speed; a finished book is put away and the next taken off the top", () => {
    let s = credit(emptyPool(ART, DAY, 0), { a: 3000 });
    const top = s.pile.at(-1)!.id;
    let w = work(s, 1);
    expect(w.state.active!.book.id).toBe(top);
    expect(w.events[0]).toMatchObject({ type: "book-started", book: { id: top } });
    s = w.state;
    // Hidden for a minute: only the clock moves.
    const hidden = work(s, 60_001, false);
    expect(pendingOf(hidden.state)).toBe(pendingOf(s));
    // Shown: 1000 a minute.
    w = work(hidden.state, 60_001 + 30_000);
    expect(pendingOf(w.state)).toBeCloseTo(2500, -1);
    expect(nextBookEnd(w.state, CFG)).toBeCloseTo(90_001 + ((w.state.active!.left / 1000) * 60_000));
    w = work(w.state, 60_001 + 10 * 60_000);
    expect(pendingOf(w.state)).toBe(0);
    expect(w.state.active).toBeNull();
    expect(w.state.done).toBe(2);
    expect(w.events.map((e) => e.type)).toContain("pile-empty");
    expect(w.state.worked).toBeCloseTo(3000);
  });

  it("other art keeps the balance; a stored pool restarts its clock; bad stores and settings fall back", () => {
    const s = credit(emptyPool(ART, DAY, 0), { a: 4200 });
    const other = { max: 2, deck: [{ cover: "green", kind: "book", units: 1 }] };
    const r = refitPool(s, other, CFG);
    expect(pendingOf(r)).toBe(4200);
    expect(r.pile).toHaveLength(2);
    const back = parsePool(JSON.parse(JSON.stringify(s)), 99)!;
    expect({ ...back, at: 0 }).toEqual({ ...s, at: 0 });
    expect(back.at).toBe(99);
    for (const junk of [null, 1, { art: "x" }, { ...s, pile: [{ id: "../x" }] }]) expect(parsePool(junk, 0)).toBeNull();
    expect(parsePoolConfig({ tokensPerBook: 7, tokensPerMinute: 100_000 })).toEqual({ tokensPerBook: 50_000, tokensPerMinute: 100_000 });
  });
});
