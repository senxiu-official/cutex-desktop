import { describe, expect, it } from "vitest";
import { autoFolds, foldView, latestReplyIds, lineHeightPx, migrateFoldLines, visualLines, type FoldPrefs } from "../src/renderer/src/lib/messageFold";
import type { TimelineEntry } from "../src/renderer/src/lib/timeline";

const on: FoldPrefs = { foldLong: true, foldLines: 12, foldOlderReplies: false };

describe("autoFolds", () => {
  it("folds the user's own messages when auto-fold is on", () => {
    expect(autoFolds("user", on)).toBe(true);
    expect(autoFolds("user", { ...on, foldLong: false })).toBe(false);
  });
  it("never folds the latest reply, older ones only when enabled", () => {
    expect(autoFolds("latest", { ...on, foldOlderReplies: true })).toBe(false);
    expect(autoFolds("older", on)).toBe(false);
    expect(autoFolds("older", { ...on, foldOlderReplies: true })).toBe(true);
    expect(autoFolds("older", { ...on, foldLong: false, foldOlderReplies: true })).toBe(false);
    expect(autoFolds("off", on)).toBe(false);
  });
});

describe("visualLines", () => {
  it("counts rendered lines from height / line-height", () => {
    expect(visualLines(20, 20)).toBe(1);
    expect(visualLines(240, 20)).toBe(12);
    expect(visualLines(241, 20)).toBe(12); // a px of margin is not a hidden line
    expect(visualLines(250, 20)).toBe(13);
    expect(visualLines(0, 20)).toBe(1);
    expect(visualLines(100, 0)).toBe(1);
  });
  it("reads computed line heights", () => {
    expect(lineHeightPx("22.75px", "14px")).toBe(22.75);
    expect(lineHeightPx("normal", "10px")).toBe(12);
    expect(lineHeightPx("1.5", "10px")).toBe(15);
  });
  it("keeps the threshold to the offered options", () => {
    expect(migrateFoldLines(20)).toBe(20);
    expect(migrateFoldLines(13)).toBe(12);
    expect(migrateFoldLines("x")).toBe(12);
  });
});

describe("foldView", () => {
  it("clips auto-folded messages before measuring (no layout change after)", () => {
    expect(foldView(true, undefined, 0, 12)).toEqual({ clipLines: 12, overflowing: false, collapsible: false, canFold: false });
    expect(foldView(true, undefined, 30, 12)).toMatchObject({ clipLines: 12, overflowing: true });
    expect(foldView(true, undefined, 5, 12)).toMatchObject({ clipLines: 12, overflowing: false });
  });
  it("opened long messages can collapse", () => {
    expect(foldView(true, "open", 30, 12)).toEqual({ clipLines: null, overflowing: false, collapsible: true, canFold: true });
    expect(foldView(false, undefined, 30, 12)).toMatchObject({ clipLines: null, collapsible: false, canFold: true });
  });
  it("manual fold: long to the threshold, short to a few lines", () => {
    expect(foldView(false, "folded", 30, 12)).toMatchObject({ clipLines: 12, overflowing: true });
    expect(foldView(false, "folded", 6, 12)).toMatchObject({ clipLines: 3, overflowing: true });
    expect(foldView(false, "folded", 2, 12)).toMatchObject({ clipLines: 1, overflowing: true });
    expect(foldView(false, undefined, 1, 12).canFold).toBe(false);
  });
});

describe("latestReplyIds", () => {
  const agent = (id: string, turnId: string): TimelineEntry => ({ kind: "agent", id, turnId, text: id, streaming: false });
  const user = (id: string, turnId: string): TimelineEntry => ({ kind: "user", id, turnId, text: id });
  it("is every agent message of the newest turn with agent text", () => {
    const entries = [user("u1", "t1"), agent("a1", "t1"), user("u2", "t2"), agent("a2", "t2"), agent("a3", "t2")];
    expect([...latestReplyIds(entries)]).toEqual(["a3", "a2"]);
  });
  it("stays on the last reply while a new turn has none yet", () => {
    expect([...latestReplyIds([user("u1", "t1"), agent("a1", "t1"), user("u2", "t2")])]).toEqual(["a1"]);
    expect(latestReplyIds([user("u1", "t1")]).size).toBe(0);
  });
});
