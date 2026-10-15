// Delegation store keyed by host (multi-host P1): a cross-host (peers) delegation has the same ask id
// on both hosts — the requester host's outgoing mirror and the handler host's record — and both stay.
import { describe, expect, it, vi } from "vitest";
import type { AskSummary } from "../src/shared/ipc";
import { applyHostAskEvent, delegationOn, hostDelegations, hostOfKey, hostSlice, mergeHostRows, withoutHost } from "../src/renderer/src/lib/delegationStore";
import { mergeSummaries, needsYouCount } from "../src/renderer/src/lib/delegations";
import { hostKey } from "../src/renderer/src/lib/hostKeys";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const ask = (over: Partial<AskSummary> = {}): AskSummary => ({
  askId: "ask-1",
  title: "Parser review",
  requester: { kind: "agent", cutexSessionId: "cutex.lead", name: "Lead" },
  target: "cutex.helper",
  targetName: "Helper",
  execution: "running",
  attempts: 1,
  createdAt: "2026-10-08T12:00:00Z",
  updatedAt: "2026-10-08T12:00:00Z",
  revision: 3,
  ...over,
});

// Host A (local): the requester's outgoing mirror. Host B (workstation): the real record, requested by a peer.
const mirror = ask({ revision: 9, execution: "running", remote: { peerId: "p-b", label: "Workstation" } as AskSummary["remote"] });
const real = ask({ revision: 2, execution: "pendingReview", requester: { kind: "peer", peerId: "p-a", cutexSessionId: "cutex.lead", label: "host-a" } });

describe("host-keyed delegation records", () => {
  it("keeps both hosts' records of the same ask id, whatever their revisions", () => {
    let byKey = mergeHostRows({}, "local", [mirror]);
    byKey = mergeHostRows(byKey, "workstation", [real]);
    expect(Object.keys(byKey).sort()).toEqual([hostKey("local", "ask-1"), hostKey("workstation", "ask-1")].sort());
    // The lower revision on workstation did not lose to local's higher one (and the other way round).
    expect(delegationOn(byKey, "local", "ask-1")).toBe(mirror);
    expect(delegationOn(byKey, "workstation", "ask-1")).toBe(real);
    // Reloading one host does not touch the other.
    const again = mergeHostRows(byKey, "local", [{ ...mirror, revision: 10, execution: "answered" }]);
    expect(delegationOn(again, "local", "ask-1")?.execution).toBe("answered");
    expect(delegationOn(again, "workstation", "ask-1")).toBe(real);
  });

  it("knows each key's host", () => {
    expect(hostOfKey(hostKey("local", "ask-1"))).toBe("local");
    expect(hostOfKey(hostKey("workstation", "ask-1"))).toBe("workstation");
    expect(hostOfKey("ask-1")).toBeNull();
  });

  it("projects one host's records by ask id (the shape lib/delegations takes), stable per records object", () => {
    const byKey = mergeHostRows(mergeHostRows({}, "local", [mirror, ask({ askId: "ask-2" })]), "workstation", [real]);
    expect(hostDelegations(byKey, "local")).toEqual({ "ask-1": mirror, "ask-2": expect.objectContaining({ askId: "ask-2" }) });
    expect(hostDelegations(byKey, "workstation")).toEqual({ "ask-1": real });
    expect(hostDelegations(byKey, "local")).toBe(hostDelegations(byKey, "local"));
  });

  it("counts needs-you per host: the same ask id on two hosts is one record in each host's view", () => {
    const byKey = mergeHostRows(mergeHostRows({}, "local", [mirror]), "workstation", [real]);
    // Only workstation' record awaits the owner's review; local's mirror runs (as far as local knows).
    expect(needsYouCount(Object.values(hostDelegations(byKey, "workstation")))).toBe(1);
    expect(needsYouCount(Object.values(hostDelegations(byKey, "local")))).toBe(0);
    expect(Object.values(hostDelegations(byKey, "local"))).toHaveLength(1);
  });

  it("applies an event to the event's host only", () => {
    const records = { byKey: mergeHostRows(mergeHostRows({}, "local", [mirror]), "workstation", [real]), progress: {}, questions: {} };
    const patch = applyHostAskEvent(records, "workstation", "cutex/ask/closed", { askId: "ask-1", revision: 3, outcome: "accepted" });
    expect(delegationOn(patch!.byKey!, "workstation", "ask-1")?.closed).toBe("accepted");
    expect(delegationOn(patch!.byKey!, "local", "ask-1")).toBe(mirror);
    // local's mirror has revision 9: the same event (revision 3) would be stale there.
    expect(applyHostAskEvent(records, "local", "cutex/ask/closed", { askId: "ask-1", revision: 3 })).toBeNull();
    // A record first seen in an event belongs to the event's host.
    const created = applyHostAskEvent(records, "workstation", "cutex/ask/created", { ask: { askId: "ask-3", title: "x", revision: 1 } });
    expect(Object.keys(created!.byKey!)).toContain(hostKey("workstation", "ask-3"));
    expect(delegationOn(created!.byKey!, "local", "ask-3")).toBeUndefined();
    // Progress notes are per host too.
    const progress = applyHostAskEvent(records, "local", "cutex/ask/progress", { askId: "ask-1", text: "half way", at: "t1" });
    expect(progress!.progress).toEqual({ [hostKey("local", "ask-1")]: [{ text: "half way", at: "t1" }] });
    expect(hostSlice(progress!.progress!, "workstation")).toEqual({});
  });

  it("drops one host's records and keeps the other's", () => {
    const s = { byKey: mergeHostRows(mergeHostRows({}, "local", [mirror]), "workstation", [real]), progress: { [hostKey("workstation", "ask-1")]: [{ text: "n", at: "a" }] }, questions: {}, details: { [hostKey("workstation", "ask-1")]: null } };
    const left = withoutHost(s, "workstation");
    expect(Object.keys(left.byKey)).toEqual([hostKey("local", "ask-1")]);
    expect(left.progress).toEqual({});
    expect(left.details).toEqual({});
    expect(left.questions).toBe(s.questions);
  });

  it("single host: the projection is what mergeSummaries made of the same rows", () => {
    const rows = [ask({ askId: "a" }), ask({ askId: "b", revision: 5 })];
    const first = mergeHostRows({}, "local", rows);
    expect(hostDelegations(first, "local")).toEqual(mergeSummaries({}, rows));
    // An older row keeps the newer record; an unchanged merge keeps the same object.
    const older = mergeHostRows(first, "local", [ask({ askId: "b", revision: 4, title: "old" })]);
    expect(older).toBe(first);
    expect(mergeHostRows(first, "local", [])).toBe(first);
  });
});
