import { describe, expect, it } from "vitest";
import { fitCount, stripItems } from "../src/renderer/src/lib/stripFit";

describe("fitCount", () => {
  it("everything fits: no overflow chip needed", () => {
    expect(fitCount([50, 50, 50], 160, 5, 60)).toBe(3);
    expect(fitCount([], 0, 5, 60)).toBe(0);
  });

  it("leaves room for the overflow chip when not all fit", () => {
    // 50 + 5 + 50 = 105; + 5 + 60 = 170 > 160 → only one chip next to 「还有 2 项」 (50 + 5 + 60 = 115).
    expect(fitCount([50, 50, 50], 160, 5, 60)).toBe(3);
    expect(fitCount([50, 50, 50, 50], 160, 5, 60)).toBe(1);
    expect(fitCount([50, 50, 50, 50], 175, 5, 60)).toBe(2);
  });

  it("a first chip wider than the room leaves only the overflow chip", () => {
    expect(fitCount([300, 20], 200, 5, 60)).toBe(0);
  });

  it("stops at the first chip that does not fit (order is kept)", () => {
    expect(fitCount([40, 200, 10], 150, 5, 50)).toBe(1);
  });
});

describe("stripItems", () => {
  const chip = (name: string, signal: string) => ({ name, signal });
  it("groups two or more 完成 into one item at the end, urgent ones stay single and first", () => {
    const items = stripItems([chip("a", "needsYou"), chip("b", "done"), chip("c", "error"), chip("d", "done")]);
    expect(items.map((i) => (i.kind === "chip" ? i.chip.name : `done:${i.chips.map((c) => c.name).join(",")}`))).toEqual(["a", "c", "done:b,d"]);
  });
  it("a single 完成 stays a normal chip", () => {
    expect(stripItems([chip("a", "done"), chip("b", "needsYou")])).toEqual([
      { kind: "chip", chip: chip("b", "needsYou") },
      { kind: "chip", chip: chip("a", "done") },
    ]);
  });
});
