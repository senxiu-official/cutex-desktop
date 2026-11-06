import { describe, expect, it, vi } from "vitest";
import { createTimelineWindow, recentEntries } from "../src/renderer/src/lib/timelineWindow";
import { emptyTimeline, orderedEntries, type TimelineEntry, type TurnView } from "../src/renderer/src/lib/timeline";
import { createTimelineIdentityEntries, createTimelineTurnIndex, TimelineEntries } from "../src/renderer/src/lib/timelineEntries";
import { replyBars, turnsFrom } from "../src/renderer/src/lib/replyActions";
import { cloneTimeline, prependHistory } from "../src/renderer/src/lib/historyPages";
import { singleTurn } from "../src/renderer/src/lib/turnFetch";
import { missingTimelineRecords } from "../src/renderer/src/lib/inputLedger/owner";
import { record } from "../src/renderer/src/lib/inputLedger/testkit";

const turns = ["t1", "t2", "t3", "t4"].map((id) => ({ id }) as TurnView);
const entries = [
  { kind: "user", id: "u1", turnId: "t1", text: "a" },
  { kind: "agent", id: "a1", turnId: "t1", text: "b", streaming: false },
  { kind: "user", id: "u2", turnId: "t2", text: "c" },
  { kind: "user", id: "u3", turnId: "t3", text: "d" },
  { kind: "agent", id: "a3", turnId: "t3", text: "e", streaming: false },
  { kind: "user", id: "u4", turnId: "t4", text: "f" },
] as unknown as TimelineEntry[];

describe("recentEntries", () => {
  it("keeps everything when the history is short or the limit is off", () => {
    expect(recentEntries(entries, turns, 4)).toEqual({ entries, hiddenTurns: 0 });
    expect(recentEntries(entries, turns, 0)).toEqual({ entries, hiddenTurns: 0 });
  });

  it("starts at the first entry of the oldest kept turn", () => {
    const r = recentEntries(entries, turns, 2);
    expect(r.hiddenTurns).toBe(2);
    expect(r.entries.map((e) => e.id)).toEqual(["u3", "a3", "u4"]);
  });
});

function auditFixture(scale: number) {
  const state = emptyTimeline();
  state.turns = Array.from({ length: 327 * scale }, (_, i) => ({ id: `t${i}`, status: "completed", startedAt: i, completedAt: i + 1, entryIds: [] }));
  for (let i = 0; i < 7974 * scale; i++) {
    const turn = state.turns[Math.floor(i * state.turns.length / (7974 * scale))]!;
    const entry: TimelineEntry = { kind: "agent", id: `i${i}`, turnId: turn.id, text: `reply ${i}`, streaming: false };
    turn.entryIds.push(entry.id);
    state.entries.set(entry.id, entry);
  }
  return state;
}

describe("window-first native derivation", () => {
  it("uses incremental history membership for ledger updates with the legacy paging result", () => {
    const state = auditFixture(10);
    state.turns[0]!.startedAt = 100;
    const records = new Map([
      ["loaded", record("loaded", { surface: "timeline", state: "inContext", turnId: "t0", timelineItemId: "missing-loaded", since: new Date(0).toISOString() })],
      ["older", record("older", { surface: "timeline", state: "inContext", turnId: "before-page", timelineItemId: "missing-older", since: new Date(0).toISOString() })],
      ["queued", record("queued", { surface: "nextUp" })],
    ]);
    const expected = missingTimelineRecords(records, [], undefined, { hasOlder: true, turns: state.turns });
    const index = createTimelineTurnIndex()(state.turns);
    const map = vi.fn();
    const watched = new Proxy(state.turns, { get(target, key, receiver) { if (key === "map") map(); return Reflect.get(target, key, receiver); } });
    const actual = missingTimelineRecords(records, [], undefined, { hasOlder: true, turns: watched, hasTurn: id => index.has(id) });
    expect(actual).toEqual(expected);
    expect(actual.map(record => record.inputId)).toEqual(["loaded"]);
    expect(map).not.toHaveBeenCalled();
  });
  it("preserves indexed collections across full/turn clones, with independent mutations", () => {
    const source = auditFixture(1);
    for (const state of [cloneTimeline(source), singleTurn(source, source.turns.at(-1)!.id)!.timeline]) {
      expect(state.entries).toBeInstanceOf(TimelineEntries);
      const select = createTimelineWindow();
      select(state, 50);
      const get = vi.spyOn(state.entries, "get");
      select(state, 50);
      expect(get).not.toHaveBeenCalled();
      const id = state.turns.at(-1)!.entryIds.at(-1)!;
      const previous = Map.prototype.get.call(state.entries, id);
      state.entries.set(id, { ...previous, text: "cloned" });
      get.mockClear();
      expect(select(state, 50).entries.at(-1)).toMatchObject({ text: "cloned" });
      expect(get).toHaveBeenCalledTimes(24);
      expect(source.entries.get(id)).not.toMatchObject({ text: "cloned" });
    }
  });
  it.each([1, 10])("counts actual entry reads at %sx audit history", scale => {
    const state = auditFixture(scale);
    const get = vi.spyOn(state.entries, "get");
    const baseline = recentEntries(orderedEntries(state), state.turns, 50);
    expect(get).toHaveBeenCalledTimes(7974 * scale);
    expect(baseline.entries).toHaveLength(1219);
    get.mockClear();
    const select = createTimelineWindow();
    const initial = select(state, 50);
    expect(initial.entries).toEqual(baseline.entries);
    expect(initial.hiddenTurns).toBe(327 * scale - 50);
    expect(get).toHaveBeenCalledTimes(1219);
    get.mockClear();
    select(state, 50);
    expect(get).not.toHaveBeenCalled();
    const last = state.turns.at(-1)!;
    const id = last.entryIds.at(-1)!;
    const previous = Map.prototype.get.call(state.entries, id) as TimelineEntry;
    state.entries.set(id, { ...previous, text: "updated" } as TimelineEntry);
    get.mockClear();
    expect(select(state, 50).entries.at(-1)).toMatchObject({ text: "updated" });
    expect(get).toHaveBeenCalledTimes(24);
    expect(last.entryIds).toHaveLength(24);
    get.mockClear();
    const old = Map.prototype.get.call(state.entries, state.turns[0]!.entryIds[0]) as TimelineEntry;
    state.entries.set(old.id, { ...old, text: "hidden update" } as TimelineEntry);
    select(state, 50);
    expect(get).not.toHaveBeenCalled();
    // Full-history copy/search input and reply/revert targets remain available.
    expect(orderedEntries(state)).toHaveLength(7974 * scale);
    expect(orderedEntries(state)[0]).toMatchObject({ text: "hidden update" });
    expect(replyBars(initial.turns, initial.entries)).toEqual(replyBars(state.turns, initial.entries));
    expect(turnsFrom(state.turns, initial.turns[0]!.id)).toBe(50);
  });

  it("widens for focus/show earlier, appends, prepends and reverts", () => {
    const state = auditFixture(1);
    const select = createTimelineWindow();
    select(state, 50);
    expect(select(state, 100).entries).toEqual(recentEntries(orderedEntries(state), state.turns, 100).entries);
    expect(select(state, 0).entries).toEqual(orderedEntries(state));
    state.turns.push({ id: "new", status: "inProgress", startedAt: 400, completedAt: null, entryIds: ["new-entry"] });
    state.entries.set("new-entry", { kind: "user", id: "new-entry", turnId: "new", text: "new" });
    expect(select(state, 50).entries.at(-1)?.id).toBe("new-entry");
    prependHistory(state, { thread: { id: "history", turns: [{ id: "older", status: "completed", items: [{ type: "agentMessage", id: "older-entry", text: "old" }] }] } });
    expect(select(state, 51).entries).toEqual(recentEntries(orderedEntries(state), state.turns, 51).entries);
    state.turns = state.turns.slice(0, 2);
    expect(select(state, 50).entries).toEqual(orderedEntries(state));
    const copy = { ...state, entries: new Map(state.entries) };
    const id = copy.turns.at(-1)!.entryIds[0]!;
    select(copy, 1);
    copy.entries.set(id, { kind: "agent", id, turnId: copy.turns.at(-1)!.id, text: "plain map repair", streaming: false });
    expect(select(copy, 1).entries[0]).toMatchObject({ text: "plain map repair" });
  });

  it("keeps orderedEntries orphan semantics and the empty-kept-window fallback", () => {
    const state = auditFixture(1);
    state.entries.set("orphan", { kind: "user", id: "orphan", clientId: "orphan-client", turnId: "t0", text: "orphan" });
    state.entries.set("sent", { kind: "sent", id: "sent", turnId: null, text: "unbound", to: "x", deliveryMode: "note" });
    const select = createTimelineWindow();
    expect(select(state, 50).entries.some(entry => entry.id === "orphan" || entry.id === "sent")).toBe(false);
    expect(createTimelineIdentityEntries()(state, ["orphan", "orphan-client", "sent"])).toEqual([]);
    state.turns.push({ id: "empty", status: "inProgress", entryIds: [], startedAt: null, completedAt: null });
    expect(select(state, 1)).toEqual({ entries: orderedEntries(state), turns: state.turns, hiddenTurns: 0 });
  });

  it("invalidates same-object sets, deletion and clear/refill, without retired revision rows", () => {
    const state = auditFixture(1);
    const entries = state.entries as TimelineEntries;
    const select = createTimelineWindow();
    select(state, 1);
    const turn = state.turns.at(-1)!;
    const id = turn.entryIds.at(-1)!;
    const entry = entries.get(id)!;
    const revision = entries.revision(turn.id);
    entries.set(id, entry);
    expect(entries.revision(turn.id)).toBeGreaterThan(revision);
    for (const item of turn.entryIds) entries.delete(item);
    expect(entries.revision(turn.id)).toBe(0);
    entries.set(id, entry);
    expect(entries.revision(turn.id)).toBeGreaterThan(revision);
    expect(select(state, 1).entries).toEqual([entry]);
    entries.clear();
    expect(entries.revision(turn.id)).toBe(0);
    entries.set(id, { ...entry, text: "after clear" } as TimelineEntry);
    expect(select(state, 1).entries).toMatchObject([{ text: "after clear" }]);
  });

  it("joins hidden native client ids with bounded lookups and releases changed identities", () => {
    const state = auditFixture(10);
    const turn = state.turns[0]!;
    const user = { kind: "user", id: "native", clientId: "client", turnId: turn.id, text: "owner" } as const;
    turn.entryIds.push(user.id);
    state.entries.set(user.id, user);
    const join = createTimelineIdentityEntries();
    const get = vi.spyOn(state.entries, "get");
    const initial = join(state, ["client"]);
    expect(initial).toEqual([user]);
    expect(get).toHaveBeenCalledTimes(2);
    expect(join(state, ["client"])).toBe(initial);
    state.entries.set(user.id, { ...user, clientId: "changed" });
    expect(join(state, ["client"])).toEqual([]);
    expect(join(state, ["changed"])).toHaveLength(1);
    state.entries.delete(user.id);
    expect(join(state, ["changed"])).toEqual([]);
  });

  it("indexes only added turns on append/prepend, then releases reverted membership", () => {
    const state = auditFixture(10);
    const index = createTimelineTurnIndex();
    expect(index(state.turns).size).toBe(3270);
    const read = vi.fn();
    const watched = new Proxy(state.turns, { get(target, key, receiver) { if (typeof key === "string" && /^\d+$/.test(key)) read(); return Reflect.get(target, key, receiver); } });
    index(watched);
    read.mockClear();
    watched.push({ id: "new", entryIds: [], status: "completed", startedAt: null, completedAt: null });
    expect(index(watched).has("new")).toBe(true);
    expect(read.mock.calls.length).toBeLessThan(12);
    expect(index(watched.slice(0, 2)).has("new")).toBe(false);
  });
});
