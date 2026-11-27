// 图片编辑 (lib/imageEdit): the operation history (undo / redo / 重置), crop geometry, replay over a fake canvas
// (rotate / crop replace the surface, later marks draw on the new one), export within the byte limit, and the
// composer attachment's keep-original / 恢复原图.
import { describe, expect, it } from "vitest";
import {
  applyEdit, canRedo, canUndo, centredRatioRect, clampRect, cropDrag, editableSrc, editedName, emptyHistory, exportEdited, meaningful,
  moveRect, nextExportScale, pushOp, redoEdit, replay, resetEdit, restoreOriginal, sizeAfter, strokeWidths, undoEdit,
  type EditOp, type EditableDraftImage, type Surface,
} from "../src/renderer/src/lib/imageEdit";

const pen = (x: number): EditOp => ({ kind: "pen", points: [{ x, y: x }], color: "#ef4444", width: 4 });

describe("edit history", () => {
  it("undoes and redoes whole steps; a new step clears redo", () => {
    let h = emptyHistory();
    expect(canUndo(h)).toBe(false);
    h = pushOp(h, pen(1));
    h = pushOp(h, pen(2));
    expect(h.ops).toHaveLength(2);
    h = undoEdit(h);
    expect(h.ops).toEqual([pen(1)]);
    expect(canRedo(h)).toBe(true);
    h = redoEdit(h);
    expect(h.ops).toEqual([pen(1), pen(2)]);
    h = undoEdit(undoEdit(h));
    expect(h.ops).toEqual([]);
    expect(canUndo(h)).toBe(false);
    expect(undoEdit(h)).toBe(h);
    h = redoEdit(h);
    h = pushOp(h, pen(3));
    expect(h.ops).toEqual([pen(1), pen(3)]);
    expect(canRedo(h)).toBe(false);
    expect(redoEdit(h)).toBe(h);
  });

  it("重置 is an undoable step; nothing to reset is no step", () => {
    const empty = emptyHistory();
    expect(resetEdit(empty)).toBe(empty);
    let h = pushOp(pushOp(empty, pen(1)), { kind: "rotate", turns: 1 });
    h = resetEdit(h);
    expect(h.ops).toEqual([]);
    h = undoEdit(h);
    expect(h.ops).toEqual([pen(1), { kind: "rotate", turns: 1 }]);
  });

  it("drops marks too small to mean anything", () => {
    expect(meaningful({ kind: "arrow", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, color: "#000000", width: 3 })).toBe(false);
    expect(meaningful({ kind: "rect", rect: { x: 0, y: 0, w: 2, h: 40 }, color: "#000000", width: 3 })).toBe(false);
    expect(meaningful({ kind: "text", at: { x: 0, y: 0 }, text: "  ", color: "#000000", size: 20 })).toBe(false);
    expect(meaningful(pen(1))).toBe(true);
  });
});

describe("geometry", () => {
  const size = { w: 400, h: 300 };

  it("clamps a crop to whole pixels inside the image", () => {
    expect(clampRect({ x: -10, y: 10.4, w: 100, h: 500 }, size)).toEqual({ x: 0, y: 10, w: 90, h: 290 });
    expect(clampRect({ x: 500, y: 0, w: 10, h: 10 }, size)).toBeNull();
  });

  it("drags a free crop in any direction and keeps it inside", () => {
    expect(cropDrag({ x: 100, y: 100 }, { x: 50, y: 400 }, null, size)).toEqual({ x: 50, y: 100, w: 50, h: 200 });
  });

  it("keeps a ratio crop at its ratio and inside the image", () => {
    const r = cropDrag({ x: 300, y: 100 }, { x: 600, y: 120 }, 1, size);
    expect(r.w).toBeCloseTo(r.h);
    expect(r.x + r.w).toBeLessThanOrEqual(400);
    const wide = cropDrag({ x: 0, y: 0 }, { x: 400, y: 300 }, 16 / 9, size);
    expect(wide.w / wide.h).toBeCloseTo(16 / 9);
    expect(wide.w).toBeLessThanOrEqual(400);
    expect(wide.h).toBeLessThanOrEqual(300);
    const up = cropDrag({ x: 200, y: 200 }, { x: 100, y: 0 }, 1, size);
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(0);
    expect(up.w).toBeCloseTo(200);
  });

  it("centres the largest box of a ratio and moves a box without leaving the image", () => {
    expect(centredRatioRect(1, size)).toEqual({ x: 50, y: 0, w: 300, h: 300 });
    expect(moveRect({ x: 350, y: 10, w: 40, h: 40 }, 100, -50, size)).toEqual({ x: 360, y: 0, w: 40, h: 40 });
  });

  it("tracks the size through rotations and crops", () => {
    expect(sizeAfter(size, [{ kind: "rotate", turns: 1 }])).toEqual({ w: 300, h: 400 });
    expect(sizeAfter(size, [{ kind: "rotate", turns: 1 }, { kind: "crop", rect: { x: 0, y: 0, w: 100, h: 50 } }, { kind: "rotate", turns: 3 }])).toEqual({ w: 50, h: 100 });
  });

  it("scales stroke widths with the image", () => {
    expect(strokeWidths({ w: 800, h: 600 })).toEqual([3, 5, 9]);
    expect(strokeWidths({ w: 4000, h: 3000 })).toEqual([12, 20, 36]);
  });
});

// ---------- a recording fake canvas ----------

interface Fake extends Surface { id: number; calls: string[] }

function fakes(opts: { bytes?: (s: Fake, type: string, q?: number) => number } = {}) {
  let next = 0;
  const made: Fake[] = [];
  const factory = (w: number, h: number): Fake => {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (target, key: string) => (key in target ? target[key] : (...args: unknown[]) => {
        calls.push(`${key}(${args.map((a) => (a && typeof a === "object" && "id" in a ? `#${(a as Fake).id}` : String(a))).join(",")})`);
      }),
      set: (target, key: string, value) => { target[key] = value; return true; },
    });
    const surface: Fake = { id: next++, width: w, height: h, calls, getContext: () => ctx as never };
    made.push(surface);
    return surface;
  };
  const encoder = {
    encode(s: Surface, type: "image/png" | "image/jpeg", q?: number) {
      const n = opts.bytes ? opts.bytes(s as Fake, type, q) : 100;
      return `data:${type};base64,${"A".repeat(Math.ceil((n * 4) / 3))}`;
    },
  };
  return { factory, made, encoder };
}

describe("replay", () => {
  const image = {} as CanvasImageSource;

  it("draws the original, then marks on the current surface; rotate and crop make new surfaces", () => {
    const { factory, made } = fakes();
    const out = replay(image, { w: 400, h: 300 }, [
      pen(5),
      { kind: "rotate", turns: 1 },
      { kind: "crop", rect: { x: 10, y: 20, w: 100, h: 50 } },
      { kind: "rect", rect: { x: 1, y: 1, w: 20, h: 20 }, color: "#000000", width: 2 },
    ], factory as never) as Fake;
    expect(made.map((s) => [s.width, s.height])).toEqual([[400, 300], [300, 400], [100, 50]]);
    expect(made[0]!.calls[0]).toBe("drawImage([object Object],0,0,400,300)");
    expect(made[0]!.calls).toContain("stroke()");
    expect(made[1]!.calls).toContain("drawImage(#0,0,0)");
    expect(out).toBe(made[2]);
    expect(out.calls[0]).toBe("drawImage(#1,10,20,100,50,0,0,100,50)");
    expect(out.calls).toContain("strokeRect(1,1,20,20)");
  });

  it("pixelates a 打码 area through a small surface, scaled back up without smoothing", () => {
    const { factory, made } = fakes();
    replay(image, { w: 400, h: 300 }, [{ kind: "mosaic", rect: { x: 0, y: 0, w: 100, h: 40 }, block: 10 }], factory as never);
    expect(made[1]!.width).toBe(10);
    expect(made[1]!.height).toBe(4);
    expect(made[1]!.calls).toContain("drawImage(#0,0,0,100,40,0,0,10,4)");
    expect(made[0]!.calls).toContain("drawImage(#1,0,0,10,4,0,0,100,40)");
  });
});

describe("export", () => {
  it("keeps a PNG that fits at full size", () => {
    const { factory, encoder } = fakes({ bytes: () => 1000 });
    const edited = factory(800, 600);
    const out = exportEdited(edited, 5000, factory as never, encoder)!;
    expect(out.type).toBe("image/png");
    expect(out.size).toEqual({ w: 800, h: 600 });
    expect(out.url.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("scales a PNG down until it fits the limit", () => {
    // Bytes grow with the area.
    const { factory, encoder } = fakes({ bytes: (s) => s.width * s.height });
    const edited = factory(2000, 1000);
    const out = exportEdited(edited, 1_000_000, factory as never, encoder)!;
    expect(out.type).toBe("image/png");
    expect(out.size.w * out.size.h).toBeLessThanOrEqual(1_000_000);
    expect(out.size.w).toBeGreaterThan(1000);
  });

  it("caps the longest side before encoding", () => {
    const { factory, encoder } = fakes({ bytes: () => 10 });
    const out = exportEdited(factory(8192, 1024), 1000, factory as never, encoder)!;
    expect(out.size).toEqual({ w: 4096, h: 512 });
  });

  it("falls back to a JPEG when no reasonable PNG fits, and gives up when nothing fits", () => {
    const { factory, encoder } = fakes({ bytes: (s, type) => (type === "image/png" ? 10_000_000 : s.width * s.height / 10) });
    const out = exportEdited(factory(2000, 1500), 300_000, factory as never, encoder)!;
    expect(out.type).toBe("image/jpeg");
    const none = fakes({ bytes: () => 10_000_000 });
    expect(exportEdited(none.factory(100, 100), 1000, none.factory as never, none.encoder)).toBeNull();
  });

  it("steps the scale by area with a margin", () => {
    expect(nextExportScale(4_000_000, 1_000_000, 1)).toBeCloseTo(0.46);
    expect(nextExportScale(1_010_000, 1_000_000, 1)).toBe(0.9);
  });
});

describe("composer attachment", () => {
  const picked: EditableDraftImage = { id: "img-1", name: "shot.jpg", preview: "data:image/jpeg;base64,AAAA", pickedLocally: true, source: { kind: "path", path: "C:\\shot.jpg" } };

  it("replaces the attachment with the edited copy and keeps the first original", () => {
    const once = applyEdit(picked, { url: "data:image/png;base64,BBBB", type: "image/png" });
    expect(once).toMatchObject({ id: "img-1", name: "shot-edited.png", preview: "data:image/png;base64,BBBB", source: { kind: "data", url: "data:image/png;base64,BBBB" } });
    expect(once.pickedLocally).toBeUndefined();
    expect(once.original).toEqual({ name: "shot.jpg", preview: "data:image/jpeg;base64,AAAA", pickedLocally: true, source: { kind: "path", path: "C:\\shot.jpg" } });
    const twice = applyEdit(once, { url: "data:image/png;base64,CCCC", type: "image/png" });
    expect(twice.name).toBe("shot-edited.png");
    expect(twice.original).toEqual(once.original);
  });

  it("恢复原图 puts the original back with its id; unedited stays as is", () => {
    const edited = applyEdit(picked, { url: "data:image/png;base64,BBBB", type: "image/png" });
    expect(restoreOriginal(edited)).toEqual(picked);
    expect(restoreOriginal(picked)).toBe(picked);
    const pasted: EditableDraftImage = { id: "img-2", name: "image", preview: "data:image/png;base64,AAAA", source: { kind: "data", url: "data:image/png;base64,AAAA" } };
    const back = restoreOriginal(applyEdit(pasted, { url: "data:image/jpeg;base64,BBBB", type: "image/jpeg" }));
    expect(back).toEqual(pasted);
    expect("pickedLocally" in back).toBe(false);
  });

  it("edits what it can draw: a preview or inline data, not a bare host path", () => {
    expect(editableSrc(picked)).toBe("data:image/jpeg;base64,AAAA");
    expect(editableSrc({ name: "x", preview: null, source: { kind: "data", url: "data:image/png;base64,QQ" } })).toBe("data:image/png;base64,QQ");
    expect(editableSrc({ name: "x", preview: null, source: { kind: "path", path: "/tmp/x.png" } })).toBeNull();
    expect(editedName("photo.JPEG", "image/jpeg")).toBe("photo-edited.jpg");
    expect(editedName("")).toBe("image-edited.png");
  });
});
