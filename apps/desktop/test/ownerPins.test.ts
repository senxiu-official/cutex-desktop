import { describe, expect, it } from "vitest";
import { asOwnerPin, ownerPinChangeOf, type OwnerPin } from "../src/shared/ownerPins";
import { openByKind, openCounts, pinRows, resolvedRows, withPin } from "../src/renderer/src/modules/bookmarks/pins/model";

const pin = (id: string, over: Partial<OwnerPin> = {}): OwnerPin => ({
  pinId: `pin-${id}`, key: null, author: "agent", agentId: "eva", agentName: "Eva", kind: "todo", title: id, detail: null, links: [], turnId: null,
  state: "open", resolvedBy: null, resolution: null, createdAt: "2026-11-10T00:00:00Z", updatedAt: "2026-11-10T00:00:00Z", resolvedAt: null, revision: 1, ...over,
});

describe("备忘 pins model", () => {
  it("groups open pins 要你定 → 要你做 → 记一下, newest first, and counts them", () => {
    const rows = pinRows({
      a: { pins: [pin("t1"), pin("n1", { kind: "note" }), pin("d1", { kind: "decide", createdAt: "2026-11-09T00:00:00Z" }), pin("d2", { kind: "decide", createdAt: "2026-11-10T01:00:00Z" })] },
      b: { pins: [pin("x", { state: "done", resolvedAt: "2026-11-10T02:00:00Z" })] },
    });
    expect(openByKind(rows).map((g) => [g.kind, g.rows.map((r) => r.pin.title)])).toEqual([["decide", ["d2", "d1"]], ["todo", ["t1"]], ["note", ["n1"]]]);
    expect(openCounts(rows)).toEqual({ action: 3, notes: 1 });
    expect(resolvedRows(rows).map((r) => [r.hostId, r.pin.title])).toEqual([["b", "x"]]);
    expect(pinRows({ a: { pins: [pin("1"), pin("2", { agentId: "mika" })] } }, "mika").map((r) => r.pin.title)).toEqual(["2"]);
  });

  it("an older revision never replaces a newer one; null removes", () => {
    const pins = [pin("a", { revision: 3, title: "new" })];
    expect(withPin(pins, "pin-a", pin("a", { revision: 2, title: "old" }))[0]!.title).toBe("new");
    expect(withPin(pins, "pin-a", pin("a", { revision: 4, title: "newer" }))[0]!.title).toBe("newer");
    expect(withPin(pins, "pin-a", null)).toEqual([]);
  });

  it("reads wire pins and change events strictly", () => {
    expect(asOwnerPin({ ...pin("ok") })?.pinId).toBe("pin-ok");
    expect(asOwnerPin({ ...pin("bad"), kind: "urgent" })).toBeNull();
    expect(asOwnerPin({ ...pin("bad"), pinId: "../x" })).toBeNull();
    expect(asOwnerPin({ ...pin("l"), links: [{ target: "https://a" }, { nope: 1 }] })?.links).toEqual([{ target: "https://a", label: null }]);
    expect(ownerPinChangeOf({ cutex: { method: "cutex/ownerPin/changed", params: { pin: pin("e") } } })?.pin?.title).toBe("e");
    expect(ownerPinChangeOf({ cutex: { method: "cutex/ownerPin/changed", params: { pinId: "pin-d", deleted: true } } })).toEqual({ pin: null, pinId: "pin-d" });
    expect(ownerPinChangeOf({ cutex: { method: "cutex/other", params: {} } })).toBeNull();
  });
});
