// Durable local "hide" marks (registry 1.4 §五, review 2026-11-14): per delivery attempt / occurrence, no expiry by age,
// pruned only when the hidden thing is gone.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addTombstone, hasTombstone, NEXT_UP_TOMBSTONES_KEY, pruneTombstones, resetTombstonesForTest, tombstoneKey, unknownWhat } from "./nextUpTombstones";
import { rowIdentity } from "./nextUpRegistry";
import { record } from "./testkit";

function memory(): Storage {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, key: i => [...data.keys()][i] ?? null,
    getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: k => { data.delete(k); }, clear: () => data.clear() };
}
const odd = (patch = {}) => record("u1", { kind: "agentMessage", state: "waiting", reason: "futureReason" as never, attempt: 1, since: "2026-11-14T00:00:00Z", ...patch });
const keyOf = (r: ReturnType<typeof record>) => tombstoneKey("local", "s1", rowIdentity(r), unknownWhat(r));

beforeEach(() => { resetTombstonesForTest(); vi.useRealTimers(); });

describe("next-up tombstones", () => {
  it("hide only this delivery attempt: a new attempt of the same id and status shows again", () => {
    const target = memory();
    expect(addTombstone(keyOf(odd()), target)).toBe(true);
    expect(hasTombstone(keyOf(odd({ rev: 9 })), target)).toBe(true); // an ordinary update of the same status stays hidden
    expect(hasTombstone(keyOf(odd({ attempt: 2, since: "2026-11-14T01:00:00Z" })), target)).toBe(false);
    expect(hasTombstone(keyOf(odd({ reason: "anotherFuture" as never })), target)).toBe(false);
  });
  it("key on the occurrence: the host's input id (ask-1, then ask-1::input-1 …); askId stays only the delegation link", () => {
    expect(rowIdentity(record("ask-1", { kind: "delegationRequest", askId: "ask-1" }))).toBe("ask-1");
    expect(rowIdentity(record("ask-1::input-1", { kind: "delegationRequest", askId: "ask-1" }))).toBe("ask-1::input-1");
    // A cleared occurrence never hides the next one of the same delegation.
    const target = memory();
    const first = record("ask-1", { kind: "delegationRequest", askId: "ask-1", state: "waiting", reason: "futureReason" as never });
    const next = record("ask-1::input-1", { kind: "delegationRequest", askId: "ask-1", state: "waiting", reason: "futureReason" as never });
    addTombstone(keyOf(first), target);
    expect(hasTombstone(keyOf(first), target)).toBe(true);
    expect(hasTombstone(keyOf(next), target)).toBe(false);
  });
  it("never expire by age (a mark from long ago still hides after a restart)", () => {
    const target = memory();
    vi.useFakeTimers({ now: Date.parse("2026-01-01T00:00:00Z") });
    addTombstone(keyOf(odd()), target);
    vi.setSystemTime(Date.parse("2027-06-01T00:00:00Z"));
    resetTombstonesForTest();
    expect(hasTombstone(keyOf(odd()), target)).toBe(true);
  });
  it("prune only marks whose input the host no longer has; a failed write keeps them", () => {
    const target = memory();
    addTombstone(tombstoneKey("local", "s1", "gone", "unknown:x"), target);
    addTombstone(tombstoneKey("local", "s1", "live", "unknown:x"), target);
    expect(pruneTombstones((_h, _s, id) => id === "gone", target)).toBe(true);
    resetTombstonesForTest();
    expect(hasTombstone(tombstoneKey("local", "s1", "gone", "unknown:x"), target)).toBe(false);
    expect(hasTombstone(tombstoneKey("local", "s1", "live", "unknown:x"), target)).toBe(true);
    const broken = { ...memory(), getItem: () => target.getItem(NEXT_UP_TOMBSTONES_KEY), setItem: () => { throw new Error("full"); } } as Storage;
    resetTombstonesForTest();
    expect(pruneTombstones(() => true, broken)).toBe(false);
    expect(hasTombstone(tombstoneKey("local", "s1", "live", "unknown:x"), broken)).toBe(true);
  });
});
