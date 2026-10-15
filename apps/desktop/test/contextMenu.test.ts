import { describe, expect, it } from "vitest";
import { normalizeEntries, type MenuAction } from "../src/renderer/src/lib/contextMenu";

const a = (label: string): MenuAction => ({ label, onSelect: () => {} });

describe("normalizeEntries", () => {
  it("drops falsy entries and redundant separators", () => {
    const out = normalizeEntries(["separator", a("x"), false, "separator", null, "separator", a("y"), "", "separator", undefined]);
    expect(out.map((e) => (e === "separator" ? "|" : e.label))).toEqual(["x", "|", "y"]);
  });
  it("returns empty when only separators remain", () => {
    expect(normalizeEntries(["separator", false, "separator"])).toEqual([]);
  });
});
