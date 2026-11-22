import { describe, expect, it } from "vitest";
import type { NeedsYou } from "../src/renderer/src/lib/agentAttention";
import { hostKey } from "../src/renderer/src/lib/hostKeys";
import { chipDismissed, DISMISS_TTL_MS, errorKey, isDismissed, knownAgents, needFingerprint, pruneDismissals, runtimeErrorFingerprint, type Dismissals } from "../src/renderer/src/lib/needsYouDismiss";

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

  it("prunes dismissals whose need in view is gone or changed", () => {
    const fp = needFingerprint(need());
    const d: Dismissals = { same: { fp, at: 100 }, changed: { fp, at: 100 }, gone: { fp, at: 100 }, away: { fp, at: 100 }, old: { fp, at: 0 } };
    const current = new Map([
      ["same", fp],
      ["changed", needFingerprint(need({ count: 3 }))],
    ]);
    const inView = new Set(["same", "changed", "gone"]);
    // Without host snapshots nothing goes by age.
    expect(Object.keys(pruneDismissals(d, current, inView, DISMISS_TTL_MS + 50)).sort()).toEqual(["away", "old", "same"]);
    const kept: Dismissals = { same: { fp, at: 100 } };
    expect(pruneDismissals(kept, current, inView, 200)).toBe(kept);
  });

  // L1 (owner decision D5, 2026-11-17): a dismissed chip came back after 7 days with nothing changed.
  it("never drops by age a dismissal whose agent a host still lists; collects old ones of agents no host lists", () => {
    const fp = needFingerprint(need());
    const snap = (ids: string[], retired: string[] = [], over: object = {}) => ({ active: ids.map((cutexSessionId) => ({ cutexSessionId })), retired: retired.map((cutexSessionId) => ({ cutexSessionId })), projects: null, hostRows: {}, ...over }) as never;
    const k = (host: string, id: string) => hostKey(host, id);
    const known = knownAgents(["h1", "h2", "h3"], (h) => (h === "h1" ? snap(["a"], ["arch"]) : h === "h2" ? snap([], [], { partial: true }) : null));
    const old = 0;
    const d: Dismissals = {
      [k("h1", "a")]: { fp, at: old }, // listed, same need, in view
      [k("h1", "arch")]: { fp, at: old }, // archived but listed: kept
      [errorKey(k("h1", "a"))]: { fp: "e", at: old },
      [k("h1", "deleted")]: { fp, at: old }, // h1's full list has no such agent: collected
      [k("h1", "fresh")]: { fp, at: DISMISS_TTL_MS * 9 + 1 }, // gone but not old yet
      [k("h2", "x")]: { fp, at: old }, // h2's list is partial: can't tell
      [k("h3", "y")]: { fp, at: old }, // h3 not read: can't tell
      [k("removed", "z")]: { fp, at: old }, // host no longer configured
      legacyBare: { fp, at: old },
    };
    const current = new Map([[k("h1", "a"), fp], [errorKey(k("h1", "a")), "e"]]);
    const now = DISMISS_TTL_MS * 10;
    const left = Object.keys(pruneDismissals(d, current, new Set([k("h1", "a")]), now, known));
    expect(left.sort()).toEqual([k("h1", "a"), k("h1", "arch"), errorKey(k("h1", "a")), k("h1", "fresh"), k("h2", "x"), k("h3", "y")].sort());
    // Out of view but still listed (another scope): kept however old.
    expect(Object.keys(pruneDismissals({ [k("h1", "a")]: { fp, at: old } }, new Map(), new Set(), now, known))).toEqual([k("h1", "a")]);
  });

  it("knownAgents: active and archived agents of each host; unread, partial, cached or loading hosts are unsure", () => {
    const base = { active: [{ cutexSessionId: "a" }], retired: [{ cutexSessionId: "r" }], projects: null, hostRows: {} };
    const known = knownAgents(["h1", "h2", "h3", "h4", "h5"], (h) => ({ h1: base, h2: { ...base, cached: true }, h3: { ...base, loading: { loaded: 1, total: 2 } }, h4: { ...base, partial: true }, h5: null })[h] as never);
    expect(known.keys.has(hostKey("h1", "a")) && known.keys.has(hostKey("h1", "r"))).toBe(true);
    expect([...known.unsure].sort()).toEqual(["h2", "h3", "h4", "h5"]);
  });
});

// Members stopped normally kept a red 出错 in 需要你 that × could not close (owner 2026-10-26): × only marked the
// turn seen, and a runtime error is not a turn. The error itself is remembered now.
describe("出错 chip of a runtime error", () => {
  const runtime = (over: Partial<{ status: string; runtimeGeneration: number; lastError: unknown }> = {}) => ({ status: "error", runtimeGeneration: 4, lastError: { message: "app-server exited", code: 10054 }, ...over });
  const err = { signal: "error" } as const;

  it("fingerprints member generation + lastError; none when the runtime is not in error", () => {
    expect(runtimeErrorFingerprint(runtime())).toBe(runtimeErrorFingerprint(runtime()));
    expect(runtimeErrorFingerprint(runtime({ runtimeGeneration: 5 }))).not.toBe(runtimeErrorFingerprint(runtime()));
    expect(runtimeErrorFingerprint(runtime({ lastError: { message: "other" } }))).not.toBe(runtimeErrorFingerprint(runtime()));
    expect(runtimeErrorFingerprint(runtime({ status: "offline" }))).toBeNull();
    expect(runtimeErrorFingerprint(runtime({ status: "online" }))).toBeNull();
    expect(runtimeErrorFingerprint(undefined)).toBeNull();
  });

  it("the dismissed error stays hidden; a new error, a new generation or a failed turn shows the chip again", () => {
    const fp = runtimeErrorFingerprint(runtime())!;
    const d: Dismissals = { [errorKey("k")]: { fp, at: 0 } };
    expect(isDismissed(d, "k", err, undefined, fp)).toBe(true);
    expect(isDismissed(d, "k", err, undefined, runtimeErrorFingerprint(runtime({ runtimeGeneration: 5 })))).toBe(false);
    expect(isDismissed(d, "k", err, undefined, runtimeErrorFingerprint(runtime({ lastError: "crash" })))).toBe(false);
    expect(isDismissed(d, "k", err, undefined, fp, true)).toBe(false);
    expect(isDismissed(d, "k", err, undefined, null)).toBe(false);
    expect(isDismissed(d, "other", err, undefined, fp)).toBe(false);
    // A needs-you dismissal of the same member never hides its error, nor the other way round.
    expect(isDismissed({ k: { fp, at: 0 } }, "k", err, undefined, fp)).toBe(false);
    expect(isDismissed(d, "k", { signal: "needsYou" }, undefined)).toBe(false);
  });

  it("prunes an error dismissal once that member's error in view is gone or another one", () => {
    const fp = runtimeErrorFingerprint(runtime())!;
    const d: Dismissals = { [errorKey("same")]: { fp, at: 100 }, [errorKey("fixed")]: { fp, at: 100 }, [errorKey("away")]: { fp, at: 100 } };
    const current = new Map([[errorKey("same"), fp]]);
    expect(Object.keys(pruneDismissals(d, current, new Set(["same", "fixed"]), 200)).sort()).toEqual([errorKey("away"), errorKey("same")].sort());
  });
});

describe("chipDismissed (the 需要你 strip and the 现在 cards)", () => {
  const session = (runtime: object) => ({ session: { runtime } }) as never;
  it("hides a closed need and a closed runtime error, and nothing else", () => {
    const err = { status: "error", runtimeGeneration: 2, lastError: "exit 1" };
    const fp = runtimeErrorFingerprint(err)!;
    const d: Dismissals = { k: { fp: needFingerprint(need()), at: 0 }, [errorKey("e")]: { fp, at: 0 } };
    expect(chipDismissed(d, "k", { signal: "needsYou" }, need(), undefined, false)).toBe(true);
    expect(chipDismissed(d, "e", { signal: "error" }, undefined, session(err), false)).toBe(true);
    expect(chipDismissed(d, "e", { signal: "error" }, undefined, session(err), true)).toBe(false);
    expect(chipDismissed(d, "e", { signal: "error" }, undefined, session({ ...err, runtimeGeneration: 3 }), false)).toBe(false);
    expect(chipDismissed(d, "e", { signal: "error" }, undefined, undefined, false)).toBe(false);
  });
});
