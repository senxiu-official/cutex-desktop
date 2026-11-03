import { describe, expect, it } from "vitest";
import type { InputRecord } from "@cutex-desktop/protocol";
import { assertSurfaceTrace, checkSurfaceTrace, parseSurfaceTrace, surfaceSequences, type SurfaceTraceEntry } from "./surfaceTrace";
import { delivery, iso, record, T0 } from "./testkit";

/** A recorder over one session: every change bumps stateRevision, as cutex does. */
class Recorder {
  entries: SurfaceTraceEntry[] = [];
  revision = 0;
  private revs = new Map<string, number>();
  constructor(private epoch = "e1") {}

  change(ms: number, inputId: string, patch: Partial<InputRecord>) {
    this.revision += 1;
    const rev = (this.revs.get(inputId) ?? 0) + 1;
    this.revs.set(inputId, rev);
    const rec = record(inputId, { rev, stateRevision: this.revision, ...patch });
    this.entries.push({ at: iso(T0 + ms), event: { method: "cutex/input/stateChanged", params: { cutexSessionId: "cutex.s1", ledgerEpoch: this.epoch, stateRevision: this.revision, record: rec } } });
    return rec;
  }

  deliveryChanged(ms: number) {
    this.revision += 1;
    this.entries.push({ at: iso(T0 + ms), event: { method: "cutex/session/deliveryChanged", params: { cutexSessionId: "cutex.s1", ledgerEpoch: this.epoch, stateRevision: this.revision, delivery: delivery("idle", this.revision) } } });
  }

  jsonl(): string {
    return this.entries.map(entry => JSON.stringify(entry)).join("\n");
  }
}

const rules = (trace: SurfaceTraceEntry[], endAt?: number) => checkSurfaceTrace(trace, endAt === undefined ? {} : { endAt }).map(v => v.rule);

describe("assertSurfaceTrace (054 §5.2 common assertions)", () => {
  it("passes S1 (idle owner auto), S6 (queue → timeline), S10 (wake), S11 (passive note) and S16 (claimedByWait)", () => {
    const r = new Recorder();
    r.change(0, "s1", { state: "received" });
    r.change(10, "s1", { state: "sending", deadline: iso(T0 + 30_010) });
    r.change(900, "s1", { state: "inContext", evidence: "turnStartInput" });
    r.change(1000, "s6", { state: "waiting", reason: "explicitQueue", surface: "nextUp", intent: { strategy: "queue", deliveryMode: null, timing: "afterTurn" } });
    r.deliveryChanged(1100);
    r.change(5000, "s6", { state: "inContext", evidence: "turnStartInput", surface: "timeline" });
    r.change(6000, "s10", { kind: "agentMessage", state: "waiting", reason: "afterTurn", surface: "nextUp" });
    r.change(6100, "s10", { kind: "agentMessage", state: "sending", surface: "nextUp", deadline: iso(T0 + 36_100) });
    r.change(6200, "s10", { kind: "agentMessage", state: "accepted", turnId: "t9", surface: "timeline", deadline: iso(T0 + 66_200) });
    r.change(9000, "s10", { kind: "agentMessage", state: "inContext", evidence: "a4Receipt", turnId: "t9", surface: "timeline" });
    r.change(9100, "s11", { kind: "agentMessage", state: "waiting", reason: "passive", surface: "pendingNotes" });
    r.change(9200, "s11", { kind: "agentMessage", state: "inContext", evidence: "externalInputPersisted", turnId: "t10", surface: "timeline" });
    r.change(9300, "s16", { kind: "delegationResult", state: "waiting", reason: "afterTurn", surface: "nextUp" });
    r.change(9400, "s16", { kind: "delegationResult", state: "inContext", evidence: "claimedByWait", surface: "none" });
    expect(() => assertSurfaceTrace(r.jsonl())).not.toThrow();
    expect(surfaceSequences(parseSurfaceTrace(r.jsonl())).get("cutex.s1/s6")).toEqual(["nextUp", "timeline"]);
  });

  it("never timeline → nextUp, except the owner's resend (→ waiting{ownerRetry})", () => {
    const bad = new Recorder();
    bad.change(0, "x", { kind: "agentMessage", state: "accepted", surface: "timeline", turnId: "t" });
    bad.change(10, "x", { kind: "agentMessage", state: "waiting", reason: "returned", surface: "nextUp" });
    expect(rules(bad.entries)).toEqual(["surfaceDirection"]);
    expect(() => assertSurfaceTrace(bad.entries)).toThrow(/surfaceDirection.*timeline → nextUp/);

    const ok = new Recorder();
    ok.change(0, "x", { kind: "agentMessage", state: "uncertain", reason: "turnInterrupted", surface: "timeline" });
    ok.change(10, "x", { kind: "agentMessage", state: "waiting", reason: "ownerRetry", surface: "nextUp", attempt: 2 });
    expect(rules(ok.entries)).toEqual([]);
  });

  it("other forbidden moves: none → anything, timeline → pendingNotes, nextUp → pendingNotes", () => {
    for (const [from, to] of [["none", "timeline"], ["timeline", "pendingNotes"], ["nextUp", "pendingNotes"], ["pendingNotes", "nextUp"]] as const) {
      const r = new Recorder();
      r.change(0, "x", { state: "waiting", reason: "afterTurn", surface: from });
      r.change(1, "x", { state: "waiting", reason: "afterTurn", surface: to });
      expect(rules(r.entries), `${from} → ${to}`).toEqual(["surfaceDirection"]);
    }
  });

  it("stateRevision: holes and repeats fail; a new epoch starts over", () => {
    const r = new Recorder();
    r.change(0, "a", {});
    r.revision += 1; // a change the recorder never saw
    r.change(1, "a", { state: "sending" });
    expect(rules(r.entries)).toEqual(["stateRevision"]);

    const dup = new Recorder();
    dup.change(0, "a", {});
    dup.entries.push(dup.entries[0]!);
    expect(rules(dup.entries)).toEqual(["stateRevision", "recordRev"]);

    const epoch = new Recorder();
    epoch.change(0, "a", { surface: "timeline", state: "accepted" });
    const rebuilt = new Recorder("e2");
    rebuilt.change(5, "a", { surface: "timeline", state: "accepted" });
    expect(rules([...epoch.entries, ...rebuilt.entries])).toEqual([]);
  });

  it("record rev must grow", () => {
    const r = new Recorder();
    const first = r.change(0, "a", { state: "sending" });
    r.revision += 1;
    r.entries.push({ at: iso(T0 + 1), event: { method: "cutex/input/stateChanged", params: { cutexSessionId: "cutex.s1", ledgerEpoch: "e1", stateRevision: r.revision, record: { ...first, stateRevision: r.revision, state: "accepted" } } } });
    expect(rules(r.entries)).toEqual(["recordRev"]);
  });

  it("settles within the last deadline + 5 s", () => {
    const late = new Recorder();
    late.change(0, "a", { state: "sending", deadline: iso(T0 + 30_000) });
    late.change(36_000, "a", { state: "uncertain", reason: "outcomeUnknown" });
    expect(rules(late.entries)).toEqual(["deadline"]);

    const inTime = new Recorder();
    inTime.change(0, "a", { state: "sending", deadline: iso(T0 + 30_000) });
    inTime.change(34_000, "a", { state: "uncertain", reason: "outcomeUnknown" });
    expect(rules(inTime.entries)).toEqual([]);

    const open = new Recorder();
    open.change(0, "a", { state: "accepted", deadline: iso(T0 + 60_000) });
    expect(rules(open.entries, T0 + 64_000)).toEqual([]);
    expect(rules(open.entries, T0 + 66_000)).toEqual(["deadline"]);
    // Reported once, not on every later observation.
    open.change(70_000, "a", { state: "accepted", deadline: iso(T0 + 60_000), stalled: { reason: "noProgress", since: iso(T0 + 61_000) } });
    open.change(80_000, "a", { state: "inContext", evidence: "contextPersisted" });
    expect(rules(open.entries)).toEqual(["deadline"]);
  });

  it("snapshots: an inputId listed twice fails; snapshot records are observations", () => {
    const rec = record("a", { surface: "nextUp", state: "waiting", reason: "afterTurn" });
    const trace: SurfaceTraceEntry[] = [
      { at: iso(T0), snapshot: { cutexSessionId: "cutex.s1", ledgerEpoch: "e1", stateRevision: 1, records: [rec, rec] } },
      { at: iso(T0 + 1), snapshot: { cutexSessionId: "cutex.s1", ledgerEpoch: "e1", stateRevision: 2, records: [{ ...rec, rev: 2, stateRevision: 2, surface: "pendingNotes" }] } },
    ];
    expect(rules(trace)).toEqual(["oneSurface", "surfaceDirection"]);
  });

  it("ignores legacy methods and reports malformed ledger events", () => {
    const trace = parseSurfaceTrace([
      JSON.stringify({ at: iso(T0), event: { method: "cutex/userInput/queued", params: {} } }),
      JSON.stringify({ at: T0 + 1, event: { method: "cutex/stream/reset", params: {} } }),
      JSON.stringify({ at: iso(T0 + 2), event: { method: "cutex/input/stateChanged", params: { cutexSessionId: "cutex.s1" } } }),
      "",
    ].join("\r\n"));
    expect(trace).toHaveLength(3);
    expect(rules(trace)).toEqual(["format"]);
  });
});
