// 托盘 = 任务栏 (docs/design/001-tray-taskbar.md): 「需要你 N」 (modules/home/trayOrder; the entries: test/trayEntries.test.ts)
// and where its card goes at the bottom (#36, lib/trayRoom).
import { describe, expect, it } from "vitest";
import { agentEntryId, trayNeeds } from "../src/renderer/src/modules/home/trayOrder";
import { roomGeometry, sameGeometry, TRAY_ROOM_GAP } from "../src/renderer/src/lib/trayRoom";
import { TRAY_DOCK_PX } from "../src/renderer/src/lib/trayModel";

const a = (sessionId: string, hostId = "local") => ({ hostId, sessionId });

describe("需要你 N", () => {
  it("sums over the tray's agents; the first needing you is clicked", () => {
    const list = [{ id: "a", n: 0 }, { id: "b", n: 2 }, { id: "c", n: 3 }];
    expect(trayNeeds(list, (x) => x.n)).toEqual({ total: 5, first: list[1] });
    expect(trayNeeds(list.slice(0, 1), (x) => x.n)).toEqual({ total: 0, first: null });
  });
});

describe("the tray card at the bottom (#36)", () => {
  const frame = { left: 0, top: 40, right: 1600, bottom: 1000 };
  const card = (left: number, right: number) => ({ left, right, top: 40, bottom: 940 });

  it("spans the union of the conversation cards, just under them", () => {
    const g = roomGeometry({ frame, cards: [card(320, 716), card(724, 1124)], shelves: [{ left: 1130, right: 1550, top: 40, bottom: 992 }, { left: 270, right: 312, top: 40, bottom: 992 }], stage: null });
    expect(g).toEqual({ kind: "room", left: 320, width: 804, top: 940 - 40 + TRAY_ROOM_GAP, centre: false });
  });

  it("a Shelf between two conversation columns (永远偏右): the card spans the conversations and their Shelves (design 038: never the sidebar)", () => {
    const shelf = { left: 708, right: 992, top: 40, bottom: 940 };
    expect(roomGeometry({ frame, cards: [card(320, 700), card(1000, 1400)], shelves: [shelf], stage: null })).toEqual({ kind: "wide", left: 320, width: 1080, top: 940 - 40 + TRAY_ROOM_GAP, centre: false });
  });

  it("design 038: the items never send it to the band (they fold into 「… N」); only a lone strip spans its Shelf too", () => {
    // a narrow conversation (the Settings Shelf open beside it): still the card under it
    expect(roomGeometry({ frame, cards: [card(900, 1040)], shelves: [{ left: 1048, right: 1550, top: 40, bottom: 992 }], stage: null })).toMatchObject({ kind: "room", left: 900, width: 140 });
    // a lone strip (只看 Shelf): the strip and its Shelf, not the sidebar
    expect(roomGeometry({ frame, cards: [card(320, 364)], shelves: [{ left: 372, right: 1550, top: 40, bottom: 940 }], stage: null })).toMatchObject({ kind: "wide", left: 320, width: 1230 });
    // nothing wide enough to hold it: the band
    expect(roomGeometry({ frame, cards: [card(320, 364)], shelves: [], stage: null })).toEqual({ kind: "band" });
    expect(sameGeometry({ kind: "room", left: 1, width: 2, top: 3, centre: false }, { kind: "wide", left: 1, width: 2, top: 3, centre: false })).toBe(false);
  });

  it("no conversation card: the band; the desktop showing: centred over the stage's bottom", () => {
    expect(roomGeometry({ frame, cards: [], shelves: [], stage: null })).toEqual({ kind: "band" });
    expect(roomGeometry({ frame, cards: [card(0, 0)], shelves: [], stage: null })).toEqual({ kind: "band" });
    const g = roomGeometry({ frame, cards: [card(320, 1500)], shelves: [], stage: { left: 272, right: 1592, top: 40, bottom: 992 } });
    expect(g).toEqual({ kind: "room", left: 272, width: 1320, top: 992 - 40 - TRAY_DOCK_PX, centre: true });
  });

  it("re-measured: sub-pixel changes are the same place", () => {
    const g = roomGeometry({ frame, cards: [card(320, 716)], shelves: [], stage: null });
    expect(sameGeometry(g, roomGeometry({ frame, cards: [{ ...card(320.2, 716.1) }], shelves: [], stage: null }))).toBe(true);
    expect(sameGeometry(g, roomGeometry({ frame, cards: [card(330, 716)], shelves: [], stage: null }))).toBe(false);
    expect(sameGeometry({ kind: "band" }, { kind: "band" })).toBe(true);
    expect(sameGeometry(null, g)).toBe(false);
  });
});
