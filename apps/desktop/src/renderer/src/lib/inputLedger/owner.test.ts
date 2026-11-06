import { describe, expect, it } from "vitest";
import { predictedOwnerSurface, missingTimelineRecords } from "./owner";
import { inputLabel } from "./labels";
import { delivery, record } from "./testkit";
import { carriedInputs } from "./carries";

describe("idle busy owner surface", () => {
  const turn = { turnId: "t1", kind: "owner" as const, askId: null, startedAt: null, inputIds: [] };
  it.each(["auto", "interrupt"] as const)("%s keeps idle hostBusy on timeline; running turn stays nextUp", strategy => {
    expect(predictedOwnerSurface({ strategy }, delivery("held", 1, { reason: "hostBusy" }), true)).toBe("timeline");
    expect(predictedOwnerSurface({ strategy }, delivery("held", 1, { reason: "hostBusy", turn }), true)).toBe("nextUp");
    expect(predictedOwnerSurface({ strategy }, delivery("held", 1, { reason: "hostBusy" }), false)).toBe("nextUp");
    for (const reason of ["paused", "stopHold"] as const) expect(predictedOwnerSurface({ strategy }, delivery("held", 1, { reason }))).toBe("nextUp");
    for (const state of ["offline", "starting"] as const) expect(predictedOwnerSurface({ strategy }, delivery(state, 1))).toBe("nextUp");
    expect(predictedOwnerSurface({ strategy, predictedSurface: "nextUp" }, delivery("idle", 2))).toBe("nextUp");
  });
  it("queue still waits; ordered timeline holds retain A before B; failed remains until dismissed", () => {
    expect(predictedOwnerSurface({ strategy: "queue" }, delivery("held", 1, { reason: "hostBusy" }))).toBe("nextUp");
    const a = record("a", { state: "held", reason: "hostBusy" });
    const b = record("b", { state: "waiting", reason: "hostBusy" });
    const records = new Map([["b", b], ["a", a]]);
    expect(missingTimelineRecords(records, []).map(r => r.inputId)).toEqual(["a", "b"]);
    expect(inputLabel(b)).toMatchObject({ kind: "label", id: "held" });
    records.set("a", { ...a, state: "failed", reason: "admission_timeout", actions: ["retry", "dismiss"] });
    expect(missingTimelineRecords(records, []).map(r => r.inputId)).toEqual(["a", "b"]);
    records.set("a", { ...a, state: "discarded", surface: "none", actions: [] });
    expect(missingTimelineRecords(records, []).map(r => r.inputId)).toEqual(["b"]);
  });
  it.each(["held", "failed"] as const)("057 does not attach notices to an idle %s owner before a turn is bound", state => {
    const owner = record("owner", { state, reason: state === "held" ? "hostBusy" : "admission_timeout", carries: ["notice"] });
    const notice = record("notice", { kind: "systemNotice", state: "inContext", reason: "carriedByOwner", turnId: "t1" });
    const rows = new Map([[owner.inputId, owner], [notice.inputId, notice]]);
    expect(carriedInputs(rows, true).inputIds.size).toBe(0);
    expect(missingTimelineRecords(rows, []).map(r => r.inputId)).toContain("owner");
    rows.set("owner", { ...owner, state: "inContext", reason: null, turnId: "t1" });
    const joined = carriedInputs(rows, true);
    expect([...joined.inputIds]).toEqual(["notice"]);
    expect(joined.inputIds.has("owner")).toBe(false);
    expect(missingTimelineRecords(rows, []).filter(r => !joined.inputIds.has(r.inputId)).map(r => r.inputId)).toEqual(["owner"]);
  });
});
