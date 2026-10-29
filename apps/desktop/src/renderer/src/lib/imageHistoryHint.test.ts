import { describe, expect, it } from "vitest";
import { dismissImageHistoryHint, imageHeavyHistory, migrateImageHistoryHintDone } from "./imageHistoryHint";

describe("image-heavy history hint", () => {
  it("uses cutex's media reference count, not a desktop-side scan", () => {
    expect(imageHeavyHistory(undefined)).toBe(false);
    expect(imageHeavyHistory(20)).toBe(false);
    expect(imageHeavyHistory(21)).toBe(true);
  });

  it("dismisses each conversation once", () => {
    const done = dismissImageHistoryHint(["one"], "two");
    expect(done).toEqual(["one", "two"]);
    expect(dismissImageHistoryHint(done, "two")).toEqual(done);
  });

  it("sanitises stored dismissal ids", () => {
    expect(migrateImageHistoryHintDone(["one", "", "one", 3, null])).toEqual(["one"]);
    expect(migrateImageHistoryHintDone("one")).toEqual([]);
  });
});
