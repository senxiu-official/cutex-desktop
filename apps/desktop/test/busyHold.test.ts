import { describe, expect, it } from "vitest";
import { busyHoldStep, busyShown, type BusyHold } from "../src/renderer/src/lib/busyHold";

const run = (steps: [busy: boolean, followUp: boolean][]): boolean[] => {
  let state: BusyHold = { busy: steps[0]![0], holding: false };
  return steps.map(([busy, followUp]) => {
    state = busyHoldStep(state, busy, followUp);
    return busyShown(state, followUp);
  });
};

describe("busyHold: the composer's running look across a turn boundary", () => {
  it("holds through the gap before a queued message starts the next turn", () => {
    expect(run([[true, true], [false, true], [true, false]])).toEqual([true, true, true]);
  });
  it("turns idle at once when nothing follows", () => {
    expect(run([[true, false], [false, false]])).toEqual([true, false]);
  });
  it("lets go as soon as the follow-up is gone (flushed elsewhere, paused, stopped)", () => {
    expect(run([[true, true], [false, true], [false, false], [false, true]])).toEqual([true, true, false, false]);
  });
  it("turning busy is immediate and ends a hold", () => {
    expect(run([[false, false], [true, false]])).toEqual([false, true]);
    let s: BusyHold = { busy: false, holding: true };
    s = busyHoldStep(s, true, true);
    expect(s).toEqual({ busy: true, holding: false });
  });
  it("is a no-op (same object) when nothing changed", () => {
    const s: BusyHold = { busy: true, holding: false };
    expect(busyHoldStep(s, true, true)).toBe(s);
  });
});
