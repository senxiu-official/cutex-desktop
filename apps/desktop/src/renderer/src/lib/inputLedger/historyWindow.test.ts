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
