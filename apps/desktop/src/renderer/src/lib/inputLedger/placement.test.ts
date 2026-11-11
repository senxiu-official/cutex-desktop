// Owner 2026-11-10 (「这个规则就不该存在吧」): a timeline record without its native item no longer falls to the
// bottom by default. Only records still on their way (not settled, turn not finished) stay at the end; a settled one,
// or one whose turn finished, goes inline at its turn (or by its send time), with a note when the turn ended
// without its item ("在吗" pinned under the divider after an interrupt-send ended its turn before the first item).
import { describe, expect, it } from "vitest";
import { INPUT_SETTLED_STATES, INPUT_STATES, type InputRecord } from "@cutex-desktop/protocol";
import { missingTimelineRecords, placeMissingRecords, strandedNote } from "./owner";
import { iso, record, T0 } from "./testkit";
import type { TurnView } from "../timeline";

const turn = (id: string, status: TurnView["status"], startedSec: number): Pick<TurnView, "id" | "status" | "startedAt"> => ({ id, status, startedAt: startedSec });
const S0 = T0 / 1000;
// Segments: turn a (2 rows), turn c (2 rows). Turn b (interrupted, no items) has no rows of its own.
const segTurns = ["a", "a", "c", "c"];
const turns = [turn("a", "completed", S0), turn("b", "interrupted", S0 + 60), turn("c", "completed", S0 + 120)];
const ids = (list: readonly InputRecord[] | undefined) => (list ?? []).map(r => r.inputId);

describe("placeMissingRecords", () => {
  it("interrupted before its first item: inline before the next turn's rows, with the interrupted note and its own send time", () => {
    const zaima = record("zaima", { state: "inContext", turnId: "b", createdAt: iso(T0 + 60_000), since: iso(T0 + 61_000) });
    const placed = placeMissingRecords([zaima], segTurns, turns);
    expect(placed.trailing).toEqual([]);
    expect(ids(placed.before.get(2))).toEqual(["zaima"]);
    expect(strandedNote(zaima, turns)).toEqual({ key: "inputLedger.stranded.interrupted", sentAt: S0 + 60 });
  });
  it("the newest turn interrupted with nothing after it: inline at the end of the history, not in the trailing area", () => {
    const last = [...turns.slice(0, 2)];
    const zaima = record("zaima", { state: "inContext", turnId: "b", createdAt: iso(T0 + 60_000) });
    const placed = placeMissingRecords([zaima], ["a", "a"], last);
    expect(ids(placed.end)).toEqual(["zaima"]);
    expect(placed.trailing).toEqual([]);
  });
  it("a normal in-context record of the running turn waits at the end until its item arrives; then it is not missing", () => {
    const running = [turn("a", "completed", S0), turn("b", "inProgress", S0 + 60)];
    const r = record("r", { state: "inContext", turnId: "b", createdAt: iso(T0 + 60_000) });
    // Settled, turn still running: inline at its turn's place (the end), never the trailing status area.
    const placed = placeMissingRecords([r], ["a"], running);
    expect(ids(placed.end)).toEqual(["r"]);
    expect(strandedNote(r, running)).toBeNull();
    // Its item lands: joined, no longer missing at all.
    const joined = { ...r, timelineItemId: "item-r" };
    const entries = [{ kind: "user" as const, id: "item-r", text: "r", turnId: "b", clientId: "r" }];
    expect(missingTimelineRecords(new Map([["r", joined]]), entries)).toEqual([]);
  });
  it("a still-queued / in-flight record stays in the trailing area (each unsettled state)", () => {
    for (const state of INPUT_STATES.filter(s => !(INPUT_SETTLED_STATES as readonly string[]).includes(s))) {
      const r = record("q", { state, createdAt: iso(T0 + 200_000) });
      expect(ids(placeMissingRecords([r], segTurns, turns).trailing), state).toEqual(["q"]);
      // Bound to a running turn: still on its way.
      const live = [...turns, turn("d", "inProgress", S0 + 300)];
      expect(ids(placeMissingRecords([{ ...r, turnId: "d" }], segTurns, live).trailing), state).toEqual(["q"]);
      // Bound to a turn that finished: no longer trailing.
      expect(placeMissingRecords([{ ...r, turnId: "b" }], segTurns, turns).trailing, state).toEqual([]);
    }
  });
  it.each(INPUT_SETTLED_STATES)("settled %s never trails: inline at its turn, or by send time without one", state => {
    const withTurn = record("w", { state, turnId: "b", createdAt: iso(T0 + 60_000) });
    const noTurn = record("n", { state, createdAt: iso(T0 + 90_000) });
    const early = record("e", { state, createdAt: iso(T0 - 30_000) });
    const late = record("l", { state, createdAt: iso(T0 + 500_000) });
    const placed = placeMissingRecords([late, noTurn, withTurn, early], segTurns, turns);
    expect(placed.trailing).toEqual([]);
    expect(ids(placed.before.get(0))).toEqual(["e"]);
    // Before turn c's rows: b's record, then the one sent between b and c (send order).
    expect(ids(placed.before.get(2))).toEqual(["w", "n"]);
    expect(ids(placed.end)).toEqual(["l"]);
    // Only an in-context record gets the "did not reach the history" note; the others show their own status.
    expect(strandedNote(withTurn, turns) !== null).toBe(state === "inContext");
  });
  it("an inline record whose place is in hidden history is left out; trailing ones never are", () => {
    const old = record("old", { state: "failed", createdAt: iso(T0 - 600_000) });
    const queued = record("q", { state: "waiting", createdAt: iso(T0 - 600_000) });
    const placed = placeMissingRecords([old, queued], segTurns, turns, r => Date.parse(r.createdAt) < T0);
    expect(ids(placed.before.get(0))).toEqual([]);
    expect(ids(placed.trailing)).toEqual(["q"]);
  });
  it("notes for each way a turn can end without the item; none for a turn still running or unknown", () => {
    const r = (turnId: string) => record("x", { state: "inContext", turnId, createdAt: iso(T0) });
    const all = [turn("i", "interrupted", S0), turn("f", "failed", S0), turn("c", "completed", S0), turn("p", "inProgress", S0)];
    expect(strandedNote(r("i"), all)?.key).toBe("inputLedger.stranded.interrupted");
    expect(strandedNote(r("f"), all)?.key).toBe("inputLedger.stranded.failed");
    expect(strandedNote(r("c"), all)?.key).toBe("inputLedger.stranded.missing");
    expect(strandedNote(r("p"), all)).toBeNull();
    expect(strandedNote(r("zz"), all)).toBeNull();
  });
});
