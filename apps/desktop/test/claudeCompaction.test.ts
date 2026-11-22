import { describe, expect, it } from "vitest";
import { compactAt, compactionModelsOf, compactionOf, sameCompaction, validCompaction, withModelCompaction } from "../src/shared/claudeCompaction";

describe("Claude auto-compaction (design 036)", () => {
  it("follows Claude Code 2.1.301's formula", () => {
    // 1M model, nothing set would be E − 13000 = 967000; window × percent alone is not the point.
    expect(compactAt({ window: 1_000_000, percent: 100 })).toBe(967_000);
    // The 10-22 rollout file: 500000 × 90%.
    expect(compactAt({ window: 500_000, percent: 90 })).toBe(432_000);
    // A 200K model caps the window.
    expect(compactAt({ window: 533_000, percent: 100 }, 200_000)).toBe(167_000);
  });
  it("keeps the earlier stored shapes and their points", () => {
    // 约 N 万 token = window N + 33000 at 100 %; the earlier window × percent presets.
    for (const n of [300_000, 500_000, 700_000]) expect(compactAt({ window: n + 33_000, percent: 100 })).toBe(n);
    expect(compactAt({ window: 600_000, percent: 75 })).toBe(435_000);
    expect(compactAt({ window: 500_000, percent: 80 })).toBe(384_000);
    expect(compactAt({ window: 800_000, percent: 90 })).toBe(702_000);
  });
  it("validates the cutex ranges", () => {
    expect(validCompaction({ window: 100_000, percent: 1 })).toBe(true);
    expect(validCompaction({ window: 1_000_000, percent: 100 })).toBe(true);
    for (const bad of [{ window: 99_999, percent: 50 }, { window: 1_000_001, percent: 50 }, { window: 500_000, percent: 0 }, { window: 500_000, percent: 101 }, { window: 500_000.5, percent: 50 }, { window: NaN, percent: 50 }])
      expect(validCompaction(bad)).toBe(false);
    expect(compactionOf({ window: 533_000, percent: 100 })).toEqual({ window: 533_000, percent: 100 });
    expect(compactionOf({ window: 5 })).toBeNull();
    // profile-model-context-v1: only the percent (the model's own window).
    expect(validCompaction({ window: null, percent: 80 })).toBe(true);
    expect(validCompaction({ percent: 80 })).toBe(true);
    expect(compactionOf({ percent: 80 })).toEqual({ window: null, percent: 80 });
    expect(compactionOf({ window: null, percent: 0 })).toBeNull();
    expect(sameCompaction({ percent: 80 }, { window: null, percent: 80 })).toBe(true);
    expect(sameCompaction({ window: 400_000, percent: 80 }, { window: null, percent: 80 })).toBe(false);
    expect(sameCompaction(null, undefined)).toBe(true);
    expect(compactionOf(null)).toBeNull();
  });
});

describe("Claude per-model auto-compaction (design 037)", () => {
  const a = { window: 533_000, percent: 100 };
  const b = { window: 233_000, percent: 100 };
  it("sets and clears ids, an empty table is null", () => {
    const one = withModelCompaction(null, ["m1", "m1[1m]"], a);
    expect(one).toEqual({ m1: a, "m1[1m]": a });
    const two = withModelCompaction(one, ["m2"], b);
    expect(two).toEqual({ m1: a, "m1[1m]": a, m2: b });
    expect(withModelCompaction(two, ["m1", "m1[1m]"], null)).toEqual({ m2: b });
    expect(withModelCompaction({ m2: b }, ["m2"], null)).toBeNull();
    expect(withModelCompaction(null, ["x"], null)).toBeNull();
  });
  it("does not mutate the stored table", () => {
    const stored = { m1: a };
    withModelCompaction(stored, ["m1"], b);
    expect(stored).toEqual({ m1: a });
  });
  it("reads only valid entries from the API", () => {
    expect(compactionModelsOf({ ok: a, bad: { window: 5, percent: 50 }, worse: 3 })).toEqual({ ok: a });
    expect(compactionModelsOf({})).toBeNull();
    expect(compactionModelsOf(null)).toBeNull();
    expect(compactionModelsOf([a])).toBeNull();
  });
  it("shows a smaller model context as the cap", () => {
    expect(compactAt(a, 200_000)).toBe(167_000);
  });
});
