// 只看 Shelf (docs/design/002 补充 10-22; lib/shelfOnly, lib/workspaceRow `keepShelves`): stored records read back,
// which panes show only their Shelf (one workspace too), the Shelf's new width, and the two-workspace row with
// the strip keeping its Shelf (only the neighbour changes; rails with the fold slack when the other column would
// lose its minimum).
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

import { readShelfOnly, shelfOnlyPanes, shelfOnlyWidth } from "../src/renderer/src/lib/shelfOnly";
import { conversationPanes, defaultLayout, openBeside } from "../src/renderer/src/lib/paneLayout";
import { expandedBox, STRIP_W, workspaceRow } from "../src/renderer/src/lib/workspaceRow";
import { CARD_GAP, COLLAPSED_SHELF_WIDTH } from "../src/renderer/src/lib/sideLayout";
import { FOLD_HYSTERESIS } from "../src/renderer/src/lib/foldHysteresis";

const one = () => defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "a1" });
const two = () => openBeside(one(), { hostId: "local", sessionId: "b2" }, 10);

describe("只看 Shelf", () => {
  it("reads stored records back (malformed ones dropped)", () => {
    expect(readShelfOnly(null)).toEqual({});
    expect(readShelfOnly({ "local|a1": { at: 5, shelfId: "s1", before: 420 }, "local|b2": { shelfId: "" }, bad: { shelfId: "x" }, "local|c3": { shelfId: "s2" } })).toEqual({
      "local|a1": { at: 5, shelfId: "s1", before: 420 },
      "local|c3": { at: 0, shelfId: "s2", before: null },
    });
  });

  it("the panes showing only their Shelf: one workspace too, and the focused one", () => {
    expect(shelfOnlyPanes(one(), { "local|a1": { at: 1, shelfId: "s", before: null } })).toEqual(conversationPanes(one()));
    const l = two();
    const [, right] = conversationPanes(l);
    expect(shelfOnlyPanes(l, { "local|b2": { at: 1, shelfId: "s", before: null } })).toEqual([right]);
    expect(shelfOnlyPanes(l, {})).toEqual([]);
  });

  it("the Shelf takes the column's width less the strip, plus the row's free room, within its range", () => {
    expect(shelfOnlyWidth({ shelf: 420, column: 770, free: 80 })).toBe(420 + 770 - STRIP_W + 80);
    expect(shelfOnlyWidth({ shelf: 420, column: 400, free: 0 })).toBe(420 + 400 - STRIP_W);
    expect(shelfOnlyWidth({ shelf: 1200, column: 900, free: 300 })).toBe(1600);
  });

  it("two workspaces: the strip keeps its Shelf at its width; the other column is unchanged by content", () => {
    const row = workspaceRow({
      area: 1320,
      mode: "content",
      placement: "outer",
      workspaces: [
        { want: 398, min: 300, rail: false, shelves: [] },
        { want: 398, min: 300, rail: false, shelves: [{ id: "s", side: "right", width: 774, collapsed: false }], strip: true, keepShelves: true },
      ],
    });
    expect(row.workspaces[1]).toMatchObject({ width: STRIP_W, shelves: [{ id: "s", expanded: true, box: expandedBox(774) }] });
    expect(row.workspaces[0]!.width).toBe(398);
  });

  it("the other column would lose its minimum: the kept Shelf shows as its rail (unstored), back only with the slack", () => {
    const at = (area: number, held?: boolean) =>
      workspaceRow({
        area,
        mode: "fill",
        placement: "outer",
        held,
        workspaces: [
          { want: null, min: 300, rail: false, shelves: [] },
          { want: null, min: 300, rail: false, shelves: [{ id: "s", side: "right", width: 774, collapsed: false }], strip: true, keepShelves: true },
        ],
      });
    const need = STRIP_W + CARD_GAP + expandedBox(774) + 300;
    expect(at(need + 10).workspaces[1]!.shelves[0]).toMatchObject({ expanded: true });
    expect(at(need - 10).workspaces[1]!.shelves[0]).toMatchObject({ expanded: false, forced: true, box: COLLAPSED_SHELF_WIDTH });
    expect(at(need + 10, true).workspaces[1]!.shelves[0]).toMatchObject({ expanded: false });
    expect(at(need + FOLD_HYSTERESIS + 10, true).workspaces[1]!.shelves[0]).toMatchObject({ expanded: true });
  });
});
