import { describe, expect, it } from "vitest";
import type { NeedsYou } from "../src/renderer/src/lib/agentAttention";
import { DISMISS_TTL_MS, isDismissed, needFingerprint, pruneDismissals, type Dismissals } from "../src/renderer/src/lib/needsYouDismiss";

const need = (over: Partial<NeedsYou> = {}): NeedsYou => ({ count: 1, reasons: ["approval"], askIds: [], ...over });

describe("needs-you chip dismissal", () => {
  it("fingerprints the need: same need → same, a new or different need → different", () => {
    expect(needFingerprint(need())).toBe(needFingerprint(need()));
    expect(needFingerprint(need({ reasons: ["confirm", "approval"], count: 2 }))).toBe(needFingerprint(need({ reasons: ["approval", "confirm"], count: 2 })));
    expect(needFingerprint(need({ count: 2 }))).not.toBe(needFingerprint(need()));
    expect(needFingerprint(need({ reasons: ["ownerMessage"], notificationIds: ["n1"] }))).not.toBe(needFingerprint(need({ reasons: ["ownerMessage"], notificationIds: ["n2"] })));
    expect(needFingerprint(need({ reasons: ["acceptance"], askIds: ["a1"] }))).not.toBe(needFingerprint(need({ reasons: ["acceptance"], askIds: ["a2"] })));
    expect(needFingerprint(undefined)).toBe("needsInput");
  });

  it("hides only a needs-you chip whose need is unchanged", () => {
    const d: Dismissals = { k: { fp: needFingerprint(need()), at: 0 } };
    expect(isDismissed(d, "k", { signal: "needsYou" }, need())).toBe(true);
    expect(isDismissed(d, "k", { signal: "needsYou" }, need({ count: 2 }))).toBe(false);
    expect(isDismissed(d, "other", { signal: "needsYou" }, need())).toBe(false);
    expect(isDismissed(d, "k", { signal: "done" }, need())).toBe(false);
  });

  it("prunes dismissals whose need in view is gone or changed, and old ones", () => {
    const fp = needFingerprint(need());
    const d: Dismissals = { same: { fp, at: 100 }, changed: { fp, at: 100 }, gone: { fp, at: 100 }, away: { fp, at: 100 }, old: { fp, at: 0 } };
    const current = new Map([
      ["same", fp],
      ["changed", needFingerprint(need({ count: 3 }))],
    ]);
    const inView = new Set(["same", "changed", "gone"]);
    expect(Object.keys(pruneDismissals(d, current, inView, DISMISS_TTL_MS + 50)).sort()).toEqual(["away", "same"]);
    const kept: Dismissals = { same: { fp, at: 100 } };
    expect(pruneDismissals(kept, current, inView, 200)).toBe(kept);
  });
});
