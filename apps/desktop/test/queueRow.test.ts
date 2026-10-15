import { describe, expect, it } from "vitest";
import { rowText } from "../src/renderer/src/lib/queueRow";

describe("queue row text", () => {
  it("drops leading / trailing blank lines and return glyphs, one line", () => {
    expect(rowText("\n  fix the build ⏎\n")).toBe("fix the build");
    expect(rowText("↵ first line\nsecond\t line ↵")).toBe("first line second line");
    expect(rowText("a ⏎ b")).toBe("a ⏎ b");
    expect(rowText("   ")).toBe("");
  });
});
