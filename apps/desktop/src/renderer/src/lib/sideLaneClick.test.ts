import { describe, expect, it } from "vitest";
import { laneClickAction, type LaneClickInput } from "./sideLaneClick";

const base: LaneClickInput = { open: true, activePage: "p1", layered: false, pageId: "p1", cardId: null, cardCollapsed: false, setting: "stay" };
const click = (over: Partial<LaneClickInput>) => laneClickAction({ ...base, ...over });

describe("laneClickAction", () => {
  it("another page opens / switches to it, expanding the clicked card", () => {
    expect(click({ pageId: "p2" })).toEqual({ kind: "switch", pageId: "p2", expand: null });
    expect(click({ pageId: "p2", cardId: "c", cardCollapsed: false })).toEqual({ kind: "switch", pageId: "p2", expand: "c" });
  });

  it("a closed column opens on the page, even the active one", () => {
    expect(click({ open: false })).toEqual({ kind: "switch", pageId: "p1", expand: null });
    expect(click({ open: false, setting: "collapse", cardId: "c" })).toEqual({ kind: "switch", pageId: "p1", expand: "c" });
  });

  it("the page in view no longer closes the column by default", () => {
    expect(click({})).toEqual({ kind: "none" });
  });

  it("an icon of a collapsed card on the page in view expands it (either setting)", () => {
    expect(click({ cardId: "c", cardCollapsed: true })).toEqual({ kind: "expand", cardId: "c" });
    expect(click({ cardId: "c", cardCollapsed: true, setting: "collapse" })).toEqual({ kind: "expand", cardId: "c" });
  });

  it("an icon of a visible card on the page in view focuses it", () => {
    expect(click({ cardId: "c" })).toEqual({ kind: "focus", cardId: "c" });
  });

  it("setting 收起侧栏 keeps the old close", () => {
    expect(click({ setting: "collapse" })).toEqual({ kind: "close" });
    expect(click({ setting: "collapse", cardId: "c" })).toEqual({ kind: "close" });
  });

  it("maximised / full screen: the mode follows the page, only a collapsed card expands", () => {
    expect(click({ layered: true, setting: "collapse" })).toEqual({ kind: "switch", pageId: "p1", expand: null });
    expect(click({ layered: true, pageId: "p2", cardId: "c" })).toEqual({ kind: "switch", pageId: "p2", expand: null });
    expect(click({ layered: true, pageId: "p2", cardId: "c", cardCollapsed: true })).toEqual({ kind: "switch", pageId: "p2", expand: "c" });
  });
});
