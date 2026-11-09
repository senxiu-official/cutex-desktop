import { describe, expect, it } from "vitest";
import { missingTimelineRecords, type TimelineHistoryWindow } from "./owner";
import { iso, record, T0 } from "./testkit";
import type { TimelineEntry } from "../timeline";

const history: TimelineHistoryWindow = { hasOlder: true, turns: [{ id: "recent", startedAt: (T0 + 10000) / 1000 }] };
const old = record("old", { kind: "delegationRequest", state: "inContext", timelineItemId: "cutex-ask-msg-old", turnId: "old-turn" });
const missing = (patch = {}, window = history) => {
  const item = { ...old, ...patch };
  return missingTimelineRecords(new Map([[item.inputId, item]]), [], undefined, window);
};

describe("ledger fallbacks respect the native history page window", () => {
  it.each(["delegationRequest", "agentMessage", "systemNotice", "owner"] as const)("defers bound in-context %s from an older unloaded turn", kind => {
    expect(missing({ kind })).toEqual([]);
  });
  it("keeps a genuinely missing native row after every history page is loaded", () => {
    expect(missing({}, { ...history, hasOlder: false })).toEqual([old]);
  });
  it("joins an intermediate page while deferring the still older bound record", () => {
    const older = { ...old, since: iso(T0 - 10000) };
    const middle = record("middle", { state: "inContext", timelineItemId: "native-middle", turnId: "middle-turn", since: iso(T0 + 1000) });
    const records = new Map([[older.inputId, older], [middle.inputId, middle]]);
    expect(missingTimelineRecords(records, [], undefined, history)).toEqual([]);
    const native: TimelineEntry = { kind: "user", id: "native-middle", turnId: "middle-turn", text: "Middle owner message" };
    const middleWindow = { hasOlder: true, turns: [{ id: "middle-turn", startedAt: T0 / 1000 }, ...history.turns] };
    expect(missingTimelineRecords(records, [native], undefined, middleWindow)).toEqual([]);
    // Exhausting history restores only a genuinely absent native item, not the joined middle row.
    expect(missingTimelineRecords(records, [native], undefined, { ...middleWindow, hasOlder: false })).toEqual([older]);
  });
  it("defers a passive note persisted at the end of an older turn, in the same second the oldest loaded turn started", () => {
    // Real shape (media-ui-claude, 2026-11-08): the Claude runtime persists a passive note into context at the end of
    // the turn that read it; the next turn starts within the same second, and turn startedAt is whole seconds.
    const note = record("cutex-ask-msg-3e324c0e", {
      kind: "agentMessage", state: "inContext", turnId: "99a9bf9d", timelineItemId: "798b89dd",
      createdAt: "2026-11-08T12:00:02.830Z", since: "2026-11-08T12:03:05.277Z",
    });
    const window: TimelineHistoryWindow = { hasOlder: true, turns: [{ id: "af1928a5", startedAt: 1794139385 }, { id: "later", startedAt: 1794139500 }] };
    expect(missingTimelineRecords(new Map([[note.inputId, note]]), [], undefined, window)).toEqual([]);
    // A record that entered context a second after that turn started is not older history.
    const fresh = { ...note, turnId: "not-yet-arrived", since: "2026-11-08T12:03:06.000Z" };
    expect(missingTimelineRecords(new Map([[fresh.inputId, fresh]]), [], undefined, window)).toEqual([fresh]);
  });
  it("keeps a missing item from a loaded turn", () => {
    expect(missing({ turnId: "recent" })).toHaveLength(1);
  });
  it("keeps new in-context records whose native turn has not arrived", () => {
    expect(missing({ since: iso(T0 + 20000) })).toHaveLength(1);
  });
  it("uses state-since, not an old creation time, for a queued input entering context now", () => {
    expect(missing({ createdAt: iso(T0 - 86400000), since: iso(T0 + 20000) })).toHaveLength(1);
  });
  it.each([{ timelineItemId: null }, { turnId: null }, { state: "accepted" }, { state: "uncertain" }, { since: "invalid" }])("keeps records without proof they belong to older history: %j", patch => {
    expect(missing(patch)).toHaveLength(1);
  });
  it.each([{ hasOlder: true, turns: [] }, { hasOlder: true, turns: [{ id: "recent", startedAt: null }] }])("does not defer without a dated loaded boundary: %j", window => {
    expect(missing({}, window)).toEqual([old]);
  });
  it("never changes or deletes the authoritative record", () => {
    const records = new Map([[old.inputId, old]]);
    const original = structuredClone(old);
    expect(missingTimelineRecords(records, [], undefined, history)).toEqual([]);
    expect(records.get(old.inputId)).toBe(old);
    expect(old).toEqual(original);
  });
});
