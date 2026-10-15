import { describe, expect, it } from "vitest";
import type { AdmissionNextStep } from "@cutex-desktop/protocol";
import { settledIds, shownNextStep, STARTS_NOW_DELAY_MS } from "../src/renderer/src/lib/settledRideAlongs";

const item = (id: string, enqueuedAt: string | undefined): AdmissionNextStep => ({ id, deliveryKind: "alarm", label: id, enqueuedAt, timing: "afterTurn" }) as AdmissionNextStep;

describe("settled ride-alongs (one filter for the queue card's rows, count, chips and visibility)", () => {
  it("settles by enqueue time, else by first sight; reports the next settle", () => {
    const seen = new Map<string, number>();
    const now = 1_000_000;
    const old = item("old", new Date(now - 10_000).toISOString());
    const fresh = item("fresh", new Date(now - 500).toISOString());
    const unknown = item("unknown", undefined);
    const r = settledIds([old, fresh, unknown], STARTS_NOW_DELAY_MS, now, seen);
    expect([...r.settled]).toEqual(["old"]);
    expect(r.nextInMs).toBe(STARTS_NOW_DELAY_MS - 500);
    expect([...settledIds([old, fresh, unknown], STARTS_NOW_DELAY_MS, now + STARTS_NOW_DELAY_MS, seen).settled]).toEqual(["old", "fresh", "unknown"]);
  });
  it("hides only free items still settling while idle; all while a turn runs; same array when nothing is hidden", () => {
    const list = [item("a", undefined), item("b", undefined)];
    expect(shownNextStep(list, true, null, new Set())).toBe(list);
    expect(shownNextStep(list, false, null, new Set(["a"])).map((i) => i.id)).toEqual(["a"]);
    expect(shownNextStep(list, false, null, new Set(["a", "b"]))).toBe(list);
  });
});
