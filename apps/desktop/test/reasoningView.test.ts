import { describe, expect, it } from "vitest";
import { DEFAULT_REASONING_VIEW, migrateReasoningView, REASONING_VIEW_REV } from "../src/renderer/src/lib/reasoningView";

describe("migrateReasoningView", () => {
  it("defaults to collapsed", () => {
    expect(DEFAULT_REASONING_VIEW).toBe("collapsed");
    expect(migrateReasoningView(undefined, undefined)).toBe("collapsed");
    expect(migrateReasoningView("bogus", REASONING_VIEW_REV)).toBe("collapsed");
  });

  it("turns the old default 'expanded' saved before rev 2 into collapsed", () => {
    expect(migrateReasoningView("expanded", undefined)).toBe("collapsed");
    expect(migrateReasoningView("expanded", 1)).toBe("collapsed");
  });

  it("keeps choices made since, and non-default old values", () => {
    expect(migrateReasoningView("expanded", REASONING_VIEW_REV)).toBe("expanded");
    expect(migrateReasoningView("hidden", undefined)).toBe("hidden");
    expect(migrateReasoningView("collapsed", undefined)).toBe("collapsed");
  });
});
