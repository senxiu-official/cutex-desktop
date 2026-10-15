import { describe, expect, it } from "vitest";
import { forkInput, initSide, parseSideParams, restoreSide, sideStart, takeSideText } from "../src/renderer/src/modules/side-chat/cardState";

describe("Side card state", () => {
  it("does not persist a one-shot prompt or replay it after restoring", () => {
    const state = initSide({ text: "private question", turnId: "t1" }, null);
    expect(JSON.stringify(state)).not.toContain("private question");
    expect(sideStart(state.start)).toEqual({ text: "private question", turnId: "t1" });
    expect(takeSideText(state.start)).toBe("private question");
    expect(takeSideText(state.start)).toBe("");
    expect(restoreSide(state)).toBeNull();
    expect(restoreSide({ chatId: "side-1", text: "do not replay", start: "old" })).toEqual({ chatId: "side-1" });
  });
  it("preserves a live singleton and records a new requested anchor separately", () => {
    const state = initSide({ turnId: "t2" }, { chatId: "side-1" });
    expect(state.chatId).toBe("side-1");
    expect(sideStart(state.request).turnId).toBe("t2");
  });
  it("forks all history by default even when anchored to an older turn", () => {
    expect(forkInput({ turnId: "t2" }, "all", "")).toEqual({ anchorTurnId: "t2" });
    expect(forkInput({ turnId: "t2" }, "through", "gpt-test")).toEqual({ anchorTurnId: "t2", lastTurnId: "t2", model: "gpt-test" });
    expect(forkInput({ turnId: "t2", lastTurnId: "t1", model: "override" }, "all", "fallback")).toEqual({ anchorTurnId: "t2", lastTurnId: "t1", model: "override" });
  });
  it("validates only supported params with native byte limits", () => {
    expect(parseSideParams({ turnId: "../bad" })).toBeNull();
    expect(parseSideParams({ model: "字".repeat(100) })).toBeNull();
    expect(parseSideParams({ text: "字".repeat(22000) })).toBeNull();
    expect(parseSideParams({ threadId: "native-id", turnId: "t1" })).toEqual({ turnId: "t1" });
  });
});
