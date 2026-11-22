// Bounded agent-bus bootstrap (bootstrap-bounded-bus): the open of a long-running agent does not need its
// whole received history (host-a 2026-11-16: project-lead 1609 rows, ~11 MB, 1573 delivered in turns long gone).
import { describe, expect, it } from "vitest";
import type { BusMessagesPage } from "@cutex-desktop/protocol";
import { BUS_FILTER_MAX_BYTES, BUS_FILTER_MAX_IDS, BUS_PAGE_BUDGET, boundedBusPage, busHydrationTasks, busLinksOf, readLinkedBusMessages, type BusMessagesQuery } from "../src/renderer/src/lib/boundedBus";
import { pendingMessagesFor, seedMessages, type MessageMap } from "../src/renderer/src/lib/legacyDelivery/agentMessages";
import { pendingSectionMessages } from "../src/renderer/src/lib/legacyDelivery/admissionOrder";
import { settlementFixture } from "../src/renderer/src/modules/agent-bus/settlementFixture";

const NOW = 1_794_000_000;
const VISIBLE_TURNS = Array.from({ length: 30 }, (_, i) => `turn-${i}`);

/** The received snapshot of an old Director, shaped like the host-a capture (bodies invented). */
function directorSnapshot(): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const row = (i: number, extra: Record<string, unknown>) => rows.push({
    messageId: `m-${String(i).padStart(4, "0")}`, fromCutexSessionId: `peer-${i % 4}`, toCutexSessionId: "alice",
    deliveryKind: i % 3 ? "note" : "wake", deliveryMode: i % 3 ? "passive" : "after_turn", body: `old note ${i}`,
    queuedAt: NOW - 86_400 * 3 + i * 60, ...extra,
  });
  let i = 0;
  for (let n = 0; n < 1272; n++, i++) row(i, { state: "delivered", deliveredAt: NOW - 86_400 * 2 + i, contextTurnId: `gone-${i}` });
  for (let n = 0; n < 299; n++, i++) row(i, { state: "delivered", deliveredAt: NOW - 86_400 + i, contextTurnId: null });
  for (let n = 0; n < 24; n++, i++) row(i, { state: "delivered", deliveredAt: NOW - 600 + n, contextTurnId: VISIBLE_TURNS[n] });
  for (let n = 0; n < 2; n++, i++) row(i, { state: "delivered", deliveredAt: NOW - 300 + n, contextTurnId: null, visibleItem: true });
  for (let n = 0; n < 10; n++, i++) row(i, { state: "quarantined" });
  for (let n = 0; n < 2; n++, i++) row(i, { state: "inbox_accepted", settlement: { ...settlementFixture(), state: "closed", canClose: false, closure: { actor: "owner", closedAt: "2026-11-15T00:00:00Z", reason: "stale", requestId: `close-${n}` } } });
  // A live one: waiting for the next turn (must show in 待读留言 whichever read the open uses).
  row(i++, { state: "pending" });
  return rows;
}

const TERMINAL = new Set(["delivered", "discarded", "failed", "followup_closed"]);
/** The host's bounded selection (bounded-bus-design.md): unresolved rows, rows of the shown turns / items, the latest 20 unlinked. */
function hostBounded(all: Record<string, unknown>[], turns: ReadonlySet<string>, items: ReadonlySet<string>): Record<string, unknown>[] {
  const unlinked = all.filter((m) => TERMINAL.has(m.state as string) && !m.contextTurnId).slice(-20).map((m) => m.messageId);
  return all.filter((m) => !TERMINAL.has(m.state as string) || turns.has(m.contextTurnId as string) || items.has(m.messageId as string) || unlinked.includes(m.messageId));
}

const visibleItems = (all: Record<string, unknown>[]) => new Set(all.filter((m) => m.visibleItem).map((m) => m.messageId as string));
const shownIn = (all: Record<string, unknown>[]) => new Set(all.filter((m) => VISIBLE_TURNS.includes(m.contextTurnId as string) || m.visibleItem).map((m) => m.messageId as string));

describe("open of an agent with a long bus history (the flash)", () => {
  it("never lists an old delivered or closed message as waiting, even from a full (old host) bootstrap", () => {
    const all = directorSnapshot();
    const map = seedMessages({}, "alice", all, []);
    // Nothing of the timeline is loaded yet (first render): readIn knows no item.
    const pending = pendingMessagesFor(map, "alice", () => false);
    expect(pending.map((m) => m.messageId)).toEqual(["m-1609"]);
    const features = new Set(["agent-messages-v2"]);
    expect(pendingSectionMessages(features, pending, null).map((m) => m.messageId)).toEqual(["m-1609"]);
    // A turn that finished later than every old note does not change it either.
    for (const m of pendingMessagesFor(map, "alice", () => false, new Set(), NOW, true)) expect(m.messageId).toBe("m-1609");
  });
});

describe("bounded vs full bootstrap", () => {
  it("gives the same records and 待读留言 for the shown window", () => {
    const all = directorSnapshot();
    const bounded = hostBounded(all, new Set(VISIBLE_TURNS), visibleItems(all));
    expect(bounded.length).toBeLessThan(80);
    const full = seedMessages({}, "alice", all, []);
    const small = seedMessages({}, "alice", bounded, []);
    expect(pendingMessagesFor(small, "alice", () => false)).toEqual(pendingMessagesFor(full, "alice", () => false));
    for (const id of shownIn(all)) expect(small[id]).toEqual(full[id]);
    // Unresolved rows are all kept, whatever their age.
    for (const m of all) if (!TERMINAL.has(m.state as string)) expect(small[m.messageId as string]).toEqual(full[m.messageId as string]);
  });

  it("reads busMessagesPage only from a bounded read", () => {
    expect(boundedBusPage(undefined)).toBeNull();
    expect(boundedBusPage(null)).toBeNull();
    expect(boundedBusPage({ received: { hasMore: true } })).toEqual({ received: true, sent: false });
  });
});

const pageOf = (direction: "received" | "sent", messages: unknown[], nextCursor: string | null): BusMessagesPage =>
  ({ contractVersion: 2, cutexSessionId: "alice", direction, messages, page: { limit: 200, nextCursor, hasMore: nextCursor !== null } });

const ids = (rows: unknown[]) => rows.map((m) => (m as { messageId: string }).messageId).sort();
/** A page merge as the store does it (agentMessageStore mergePage). */
const mergePage = (map: MessageMap, got: { received: unknown[]; sent: unknown[] }) => seedMessages(map, "alice", got.received, got.sent, false);

describe("paging older turns' bus messages", () => {
  it("reads every page of the filtered set and merges by messageId", async () => {
    const all = directorSnapshot();
    let map: MessageMap = seedMessages({}, "alice", hostBounded(all, new Set(VISIBLE_TURNS), visibleItems(all)), []);
    const older = ["gone-0", "gone-1", "gone-2", "gone-3"];
    const rows = all.filter((m) => older.includes(m.contextTurnId as string));
    const calls: BusMessagesQuery[] = [];
    const got = await readLinkedBusMessages(async (q) => {
      calls.push(q);
      if (q.direction === "sent") return pageOf("sent", [], null);
      // Two pages, overlapping by one row (weak snapshot under concurrent writes).
      return q.cursor === null ? pageOf("received", rows.slice(2), "k1") : pageOf("received", rows.slice(0, 3), null);
    }, busHydrationTasks(["received", "sent"], older, []));
    expect(calls.map((c) => [c.direction, c.cursor, c.turnIds.length])).toEqual([["received", null, 4], ["received", "k1", 4], ["sent", null, 4]]);
    expect(ids(got.received)).toEqual(["m-0000", "m-0001", "m-0002", "m-0003"]);
    expect(got.rest).toEqual([]);
    const before = Object.keys(map).length;
    map = mergePage(map, got);
    expect(Object.keys(map).length).toBe(before + 4);
    expect(map["m-0000"]).toMatchObject({ state: "delivered", turnId: "gone-0" });
    expect(pendingMessagesFor(map, "alice", () => false).map((m) => m.messageId)).toEqual(["m-1609"]);
  });

  // Review repro 1 (peer-review): a cached pending message whose delivery event was missed.
  it("advances a cached pending message when its older-turn page proves delivery or closure", async () => {
    let map = seedMessages({}, "alice", [
      { messageId: "m", state: "pending", fromCutexSessionId: "bob", body: "note" },
      { messageId: "c", state: "inbox_accepted", fromCutexSessionId: "bob", body: "x", settlement: settlementFixture() },
    ], []);
    map = seedMessages(map, "alice", [], []); // the new bounded bootstrap omits both (old, now terminal)
    const closed = { ...settlementFixture(), state: "closed", canClose: false, closure: { actor: "owner", closedAt: "2026-11-16T00:00:00Z", reason: "stale", requestId: "r" } };
    const got = await readLinkedBusMessages(async () => pageOf("received", [
      { messageId: "m", state: "delivered", contextTurnId: "old", deliveredAt: 42 },
      { messageId: "c", state: "inbox_accepted", settlement: closed },
    ], null), busHydrationTasks(["received"], ["old"], []));
    map = mergePage(map, got);
    expect(map.m).toMatchObject({ state: "delivered", turnId: "old" });
    expect(map.c?.settlement?.state).toBe("closed");
    expect(pendingMessagesFor(map, "alice", () => false)).toEqual([]);
  });

  it("never moves a newer live state back when an older page lands after it", () => {
    const later = new Date(Date.now() + 60_000).toISOString();
    let map = seedMessages({}, "alice", [
      { messageId: "m", state: "pending", fromCutexSessionId: "bob", body: "note" },
      { messageId: "u", state: "inbox_accepted", fromCutexSessionId: "bob", body: "x" },
    ], []);
    // Live: m delivered; u got outcome-unknown evidence observed after the page was read.
    map = seedMessages(map, "alice", [{ messageId: "m", state: "delivered", contextTurnId: "t", deliveredAt: 50 }], []);
    const fresh = { ...settlementFixture(), evidence: { ...settlementFixture().evidence, observedAt: later } };
    map = seedMessages(map, "alice", [{ messageId: "u", state: "inbox_accepted", settlement: fresh }], []);
    const stale = { ...settlementFixture(), evidence: { ...settlementFixture().evidence, observedAt: "2026-11-01T00:00:00Z" } };
    map = mergePage(map, { received: [{ messageId: "m", state: "pending" }, { messageId: "u", state: "inbox_accepted", settlement: stale }], sent: [] });
    expect(map.m?.state).toBe("delivered");
    expect(map.u?.settlement?.evidence.observedAt).toBe(later);
    // A page row without a settlement is no news about the one the store has.
    map = mergePage(map, { received: [{ messageId: "u", state: "inbox_accepted" }], sent: [] });
    expect(map.u?.settlement?.evidence.observedAt).toBe(later);
  });

  it("maps a paged sent row's error like the full snapshot", () => {
    const map = seedMessages({}, "alice", [], [{ messageId: "s", toCutexSessionId: "bob", state: "failed", error: { code: "target_unavailable", message: "bob is offline" } }], false);
    expect(map.s).toMatchObject({ state: "failed", error: "bob is offline", from: "alice", to: "bob" });
  });

  // Review repro 2: a valid filtered set longer than any page cap is read in full.
  it("reads a long filtered set to its end (no silent page cap)", async () => {
    const count = 10_001;
    let calls = 0;
    const got = await readLinkedBusMessages(async (q) => {
      calls++;
      const offset = q.cursor === null ? 0 : Number(q.cursor);
      const end = Math.min(count, offset + 200);
      return pageOf("received", Array.from({ length: end - offset }, (_, n) => ({ messageId: `m-${offset + n}` })), end < count ? String(end) : null);
    }, busHydrationTasks(["received"], ["old"], []));
    expect(got.received).toHaveLength(count);
    expect(calls).toBe(51);
    expect(got.rest).toEqual([]);
  });

  // Review repro 3: a cursor that does not move.
  it("stops a repeated cursor at once and keeps the task to retry", async () => {
    let calls = 0;
    const got = await readLinkedBusMessages(async () => { calls++; return pageOf("received", [], "same"); }, busHydrationTasks(["received"], ["old"], []));
    expect(calls).toBeLessThanOrEqual(2);
    expect(got.rest).toEqual([{ direction: "received", turnIds: ["old"], itemIds: [], cursor: "same" }]);
  });

  it("returns the unread rest at the page budget and resumes from it", async () => {
    const count = 25;
    const read = async (q: BusMessagesQuery) => {
      const offset = q.cursor === null ? 0 : Number(q.cursor);
      return pageOf(q.direction, [{ messageId: `${q.direction}-${offset}` }], offset + 1 < count ? String(offset + 1) : null);
    };
    const first = await readLinkedBusMessages(read, busHydrationTasks(["received", "sent"], ["old"], []), 10);
    expect(first.received).toHaveLength(10);
    expect(first.rest).toEqual([{ direction: "received", turnIds: ["old"], itemIds: [], cursor: "10" }, { direction: "sent", turnIds: ["old"], itemIds: [], cursor: null }]);
    const second = await readLinkedBusMessages(read, first.rest);
    expect(second.received).toHaveLength(15);
    expect(second.sent).toHaveLength(25);
    expect(second.rest).toEqual([]);
    expect(BUS_PAGE_BUDGET).toBeGreaterThanOrEqual(100);
  });

  it("keeps a failed read for retry and goes on with the other tasks", async () => {
    const turns = Array.from({ length: BUS_FILTER_MAX_IDS * 2 + 5 }, (_, i) => `t${i}`);
    const calls: BusMessagesQuery[] = [];
    const got = await readLinkedBusMessages(async (q) => {
      calls.push(q);
      if (q.direction === "sent") throw new Error("offline");
      return pageOf("received", [{ messageId: `r-${calls.length}` }], null);
    }, busHydrationTasks(["received", "sent"], turns, ["i1"]));
    expect(calls.filter((c) => c.direction === "received").map((c) => [c.turnIds.length, c.itemIds.length])).toEqual([[200, 0], [200, 0], [5, 1]]);
    expect(calls.filter((c) => c.direction === "sent")).toHaveLength(3);
    expect(got.received).toHaveLength(3);
    expect(got.rest.map((t) => [t.direction, t.turnIds.length, t.cursor])).toEqual([["sent", 200, null], ["sent", 200, null], ["sent", 5, null]]);
  });

  it("keeps each filter set under the host's 16 KiB query limit and skips ids it cannot filter by", () => {
    const turns = Array.from({ length: 100 }, (_, i) => `${i}-`.padEnd(300, "x"));
    const tasks = busHydrationTasks(["received"], [...turns, "y".repeat(600), "a,b"], []);
    expect(tasks.map((c) => c.turnIds.length)).toEqual([40, 40, 20]);
    for (const c of tasks) expect([...c.turnIds, ...c.itemIds].join(",").length).toBeLessThanOrEqual(BUS_FILTER_MAX_BYTES);
  });

  it("asks nothing for turns without ids", async () => {
    let called = false;
    const got = await readLinkedBusMessages(async () => { called = true; return pageOf("received", [], null); }, busHydrationTasks(["received"], [], []));
    expect(called).toBe(false);
    expect(got.rest).toEqual([]);
  });

  it("filters by the paged turns and their received items", () => {
    const entries = new Map<string, { kind: string; id: string }>([["x1", { kind: "received", id: "x1" }], ["x2", { kind: "assistant", id: "x2" }]]);
    expect(busLinksOf([{ id: "t1", entryIds: ["x1", "x2"] }, { id: "t2", entryIds: [] }], entries)).toEqual({ turnIds: ["t1", "t2"], itemIds: ["x1"] });
  });
});
