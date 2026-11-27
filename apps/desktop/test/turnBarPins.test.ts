// 操作栏 pins (owner 2026-11-28): the reply row's and the user bubble's bars show the pinned actions in pin order.
import { describe, expect, it } from "vitest";
import { DEFAULT_TURN_BAR_PINS, layoutTurnBar, migrateTurnBarPins, refPinId, turnBarCap, turnBarPins, withTurnBarPin } from "../src/renderer/src/lib/turnBarPins";

const BOOKMARK = refPinId("bookmarks.turn");
const NOTES = refPinId("notes.turn");

describe("turnBarPins", () => {
  it("never changed: today's bar (复制 · 分叉 / 复制 · 回退并编辑) plus the inline module items", () => {
    expect(turnBarPins({}, "reply", [BOOKMARK])).toEqual(["copy", "fork", BOOKMARK]);
    expect(turnBarPins({}, "user", [BOOKMARK])).toEqual(["copy", "editResend", BOOKMARK]);
    expect(DEFAULT_TURN_BAR_PINS.reply).toEqual(["copy", "fork"]);
  });

  it("pin appends, unpin removes; each bar keeps its own list; a stored list replaces the defaults", () => {
    let s = withTurnBarPin({}, "reply", "quote", true, [BOOKMARK]);
    expect(s.reply).toEqual(["copy", "fork", BOOKMARK, "quote"]);
    expect(turnBarPins(s, "user", [BOOKMARK])).toEqual(["copy", "editResend", BOOKMARK]);
    s = withTurnBarPin(s, "reply", "fork", false, [BOOKMARK]);
    expect(turnBarPins(s, "reply", [BOOKMARK, NOTES])).toEqual(["copy", BOOKMARK, "quote"]); // a later inline item is not forced in
    s = withTurnBarPin(s, "reply", "fork", true);
    expect(s.reply).toEqual(["copy", BOOKMARK, "quote", "fork"]);
  });

  it("migrates bad stored values away", () => {
    expect(migrateTurnBarPins(null)).toEqual({});
    expect(migrateTurnBarPins(["copy"])).toEqual({});
    expect(migrateTurnBarPins({ reply: ["copy", "copy", 3, "bad id", "ref:x.y"], user: "no", other: ["copy"] })).toEqual({ reply: ["copy", "ref:x.y"] });
  });

  it("layout: pins that exist here in pin order, capped; live items after; the menu lists pinned first, then the rest in bar order", () => {
    const ids = ["copy", "fork", "fold", "quote", "revert", BOOKMARK, NOTES];
    const pins = ["quote", "copy", "gone", BOOKMARK, "revert"];
    expect(layoutTurnBar(ids, pins, 8, new Set([NOTES]))).toEqual({
      shown: ["quote", "copy", BOOKMARK, "revert"],
      live: [NOTES],
      menuPinned: ["quote", "copy", BOOKMARK, "revert"],
      menuRest: ["fork", "fold", NOTES],
    });
    // A narrow pane: only the first pins fit; the others stay reachable in 「⋯」 (still marked pinned there).
    const narrow = layoutTurnBar(ids, pins, 2, new Set([BOOKMARK]));
    expect(narrow.shown).toEqual(["quote", "copy"]);
    expect(narrow.live).toEqual([BOOKMARK]);
    expect(narrow.menuPinned).toEqual(["quote", "copy", BOOKMARK, "revert"]);
  });

  it("cap by the row's width", () => {
    expect(turnBarCap(0)).toBe(8);
    expect(turnBarCap(300)).toBe(3);
    expect(turnBarCap(400)).toBe(5);
    expect(turnBarCap(900)).toBe(8);
  });
});
