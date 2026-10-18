import { describe, expect, it } from "vitest";
import { composerEfforts, splitPinned, togglePinned } from "../src/renderer/src/lib/models";
import { formatBalance } from "../src/renderer/src/lib/quota";

const models = ["a", "b", "c", "d", "e", "f"].map((model) => ({ model }));

describe("model pins", () => {
  it("defaults to the first four, keeps explicit pin order, drops unknown pins", () => {
    expect(splitPinned(models, undefined).pinned.map((m) => m.model)).toEqual(["a", "b", "c", "d"]);
    const s = splitPinned(models, ["e", "zz", "a"]);
    expect(s.pinned.map((m) => m.model)).toEqual(["e", "a"]);
    expect(s.rest.map((m) => m.model)).toEqual(["b", "c", "d", "f"]);
  });
  it("toggling starts from the implicit defaults", () => {
    expect(togglePinned(models, undefined, "b")).toEqual(["a", "c", "d"]);
    expect(togglePinned(models, ["a"], "f")).toEqual(["a", "f"]);
  });
});

describe("formatBalance", () => {
  it("rounds long decimal strings", () => {
    expect(formatBalance("62419.1846900000", true)).toBe("62.4k");
    expect(formatBalance("62419.1846900000")).toMatch(/^62,?419$/);
    expect(formatBalance("12.3456")).toBe("12.35");
    // cutex's currency-tagged balances (DeepSeek, Moonshot .ai / .cn) show as cutex wrote them.
    expect(formatBalance("USD 49.59")).toBe("USD 49.59");
    expect(formatBalance("¥49.59", true)).toBe("¥49.59");
    expect(formatBalance("abc")).toBe("abc");
    expect(formatBalance(null)).toBe("—");
  });
});

describe("composer effort levels", () => {
  const models = [
    { model: "claude-opus-4-8", efforts: ["none", "low", "medium", "high", "xhigh", "max"] },
    { model: "claude-haiku-4-5-20251001", efforts: [] },
  ];
  it("offers only what the current model advertises", () => {
    expect(composerEfforts(models, "claude-opus-4-8")).toEqual({ efforts: models[0]!.efforts, empty: null });
  });
  it("says why the list is empty instead of guessing levels the runtime rejects", () => {
    expect(composerEfforts(models, "claude-haiku-4-5-20251001")).toEqual({ efforts: [], empty: "none" });
    expect(composerEfforts(models, "opus")).toEqual({ efforts: [], empty: "unlisted" });
    expect(composerEfforts(null, "claude-opus-4-8")).toEqual({ efforts: [], empty: "unlisted" });
    expect(composerEfforts(models, null)).toEqual({ efforts: [], empty: "unlisted" });
  });
});
