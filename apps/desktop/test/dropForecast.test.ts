// The drop preview shows the drop's result (owner 2026-10-23, item 3b): lib/dropForecast turns the layout the drop
// itself produces (moveConversation / applyToolDrop) into boxes; 拖放落点预览 (只要框线 / 框线+底色) is stored.
import { describe, expect, it } from "vitest";
import { orderForecast, pageForecast, sameBox } from "../src/renderer/src/lib/dropForecast";
import { conversationPanes, defaultLayout, moveConversation, openBeside } from "../src/renderer/src/lib/paneLayout";
import { CARD_HEADER, cardHeights, SHELF_PANE_GAP } from "../src/renderer/src/lib/sideLayout";
import { DEFAULT_APPEARANCE, parseAppearance } from "../src/renderer/src/lib/appearanceModel";

const column = { left: 1000, top: 40, width: 400, height: 851 };

describe("pageForecast", () => {
  it("lays the panes out as the page does (cardHeights, the pane gap between them)", () => {
    const cards = [
      { id: "a", size: 1, collapsed: false },
      { id: "b", size: 1, collapsed: false },
      { id: "c", size: 1, collapsed: false },
    ];
    const boxes = pageForecast(cards, column, SHELF_PANE_GAP);
    const h = cardHeights(cards, column.height, SHELF_PANE_GAP).map((x) => x.height);
    expect(boxes.get("a")).toEqual({ left: 1000, top: 40, width: 400, height: h[0] });
    expect(boxes.get("b")!.top).toBeCloseTo(40 + h[0]! + SHELF_PANE_GAP);
    expect(boxes.get("c")!.top + boxes.get("c")!.height).toBeCloseTo(column.top + column.height);
    // Three equal panes: a third each (not half of the pane dropped on).
    expect(boxes.get("c")!.height).toBeCloseTo((column.height - 2 * SHELF_PANE_GAP) / 3);
  });

  it("keeps sizes, folds a collapsed pane to its header, and a lone pane takes the whole page", () => {
    const boxes = pageForecast(
      [
        { id: "a", size: 3, collapsed: false },
        { id: "b", size: 1, collapsed: true },
      ],
      column,
      SHELF_PANE_GAP,
    );
    expect(boxes.get("b")!.height).toBe(CARD_HEADER);
    expect(boxes.get("a")!.height).toBe(column.height - SHELF_PANE_GAP - CARD_HEADER);
    expect(pageForecast([{ id: "a", size: 1, collapsed: true }], column, SHELF_PANE_GAP).get("a")!.height).toBe(column.height);
  });
});

describe("orderForecast", () => {
  const rects = new Map([
    ["main", { left: 300, top: 40, width: 446, height: 800 }],
    ["c2", { left: 760, top: 40, width: 500, height: 800 }],
  ]);

  it("two conversations side by side: dropping one on the other's right half swaps the places", () => {
    const l = openBeside(defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "a1" }), { hostId: "local", sessionId: "b2" }, 1);
    const [left, right] = conversationPanes(l) as [string, string];
    const after = moveConversation(l, left, { near: right, side: "right" });
    const r = new Map([
      [left, rects.get("main")!],
      [right, rects.get("c2")!],
    ]);
    const boxes = orderForecast(conversationPanes(l), conversationPanes(after), r);
    // The dragged one takes the other's whole place (not half of it); the other one goes to its place.
    expect(boxes.get(left)).toEqual(rects.get("c2"));
    expect(boxes.get(right)).toEqual(rects.get("main"));
  });

  it("nothing when the columns are not the same set (not a reorder) or a box is missing", () => {
    expect(orderForecast(["main", "c2"], ["main", "c3"], rects).size).toBe(0);
    expect(orderForecast(["main", "c9"], ["c9", "main"], rects).size).toBe(0);
    expect(orderForecast(["main", "c2"], ["main", "c2"], rects).get("main")).toEqual(rects.get("main"));
  });

  it("sameBox tolerates subpixel differences only", () => {
    expect(sameBox({ left: 0, top: 0, width: 10, height: 10 }, { left: 1.5, top: 0, width: 10, height: 11 })).toBe(true);
    expect(sameBox({ left: 0, top: 0, width: 10, height: 10 }, { left: 0, top: 0, width: 10, height: 40 })).toBe(false);
  });
});

describe("拖放落点预览 setting", () => {
  it("defaults to 只要框线; 框线+底色 is kept; anything else is the default", () => {
    expect(DEFAULT_APPEARANCE.dropPreview).toBe("outline");
    expect(parseAppearance({ dropPreview: "fill" }).dropPreview).toBe("fill");
    expect(parseAppearance({ dropPreview: "glow" }).dropPreview).toBe("outline");
  });
});
