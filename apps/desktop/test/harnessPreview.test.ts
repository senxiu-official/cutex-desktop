import { describe, expect, it } from "vitest";
import { pickHarnessAgent } from "../src/renderer/src/lib/harnessPreview";

describe("pickHarnessAgent", () => {
  const active = ["a", "b", "c"];
  it("prefers the agent picked in the section", () => {
    expect(pickHarnessAgent("b", "c", active)).toBe("b");
  });
  it("uses the conversation's selected agent when nothing is picked", () => {
    expect(pickHarnessAgent(null, "c", active)).toBe("c");
  });
  it("never falls back to the first sidebar agent", () => {
    expect(pickHarnessAgent(null, null, active)).toBeNull();
  });
  it("ignores ids that are not active agents", () => {
    expect(pickHarnessAgent("gone", null, active)).toBeNull();
    expect(pickHarnessAgent("gone", "a", active)).toBe("a");
    expect(pickHarnessAgent(null, "quick-chat", active)).toBeNull();
  });
});
