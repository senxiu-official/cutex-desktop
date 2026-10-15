import { afterEach, describe, expect, it, vi } from "vitest";
import { trackNoteFloat } from "../src/renderer/src/modules/notes/floatAnchor";

afterEach(() => vi.unstubAllGlobals());

function fixture(scroll = 0) {
  let scrollTop = scroll;
  const callbacks = new Map<string, () => void>(), frames = new Map<number, FrameRequestCallback>();
  let seq = 0, resize!: () => void, mutate!: () => void;
  const observed: unknown[] = [], disconnect = vi.fn();
  const rows = [
    { id: "one", top: 100, bottom: 140 }, { id: null, top: 140, bottom: 440 },
    { id: null, top: 440, bottom: 480 }, { id: "two", top: 480, bottom: 540 },
    { id: null, top: 540, bottom: 720 },
  ].map(row => ({ row, getAttribute: () => row.id, getBoundingClientRect: () => ({ ...row, top: row.top - scrollTop, bottom: row.bottom - scrollTop, right: 876 }) }));
  const scroller = {
    getBoundingClientRect: () => ({ left: 256, right: 900, top: 40, bottom: 800, height: 760 }),
    scrollBy: vi.fn(({ top }: { top: number }) => { scrollTop += top; }),
  };
  const root = { children: rows, parentElement: scroller };
  const origin = { closest: () => ({ querySelector: () => root }) } as unknown as HTMLElement;
  vi.stubGlobal("window", { innerWidth: 1200, innerHeight: 900, addEventListener: (key: string, cb: () => void) => callbacks.set(key, cb), removeEventListener: (key: string) => callbacks.delete(key) });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.set(++seq, cb); return seq; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("ResizeObserver", class { constructor(cb: () => void) { resize = cb; } observe(el: unknown) { observed.push(el); } disconnect = disconnect; });
  vi.stubGlobal("MutationObserver", class { constructor(cb: () => void) { mutate = cb; } observe() {} disconnect = disconnect; });
  const update = vi.fn(), dismiss = vi.fn();
  const flush = () => { for (const [id, cb] of frames) { frames.delete(id); cb(0); } };
  return { origin, rows, root, scroller, update, dismiss, callbacks, observed, disconnect, frames, flush, resize: () => resize(), mutate: () => mutate(), scroll: (value: number) => { scrollTop = value; callbacks.get("scroll")?.(); flush(); } };
}

describe("note float follows the actual turn boundary", () => {
  it("measures the tail, follows scroll and never scrolls again after opening", () => {
    const f = fixture();
    const stop = trackNoteFloat(f.origin, "one", f.update, f.dismiss);
    expect(f.update).toHaveBeenLastCalledWith(expect.objectContaining({ bottom: 428 })); // 900 - (480 - 8)
    f.scroll(100);
    expect(f.update).toHaveBeenLastCalledWith(expect.objectContaining({ bottom: 528 }));
    expect(f.scroller.scrollBy).not.toHaveBeenCalled();
    f.scroll(-400);
    expect(f.dismiss).toHaveBeenCalledOnce();
    expect(f.scroller.scrollBy).not.toHaveBeenCalled();
    stop(); expect(f.callbacks.size).toBe(0); expect(f.frames.size).toBe(0);
  });
  it("reveals an offscreen tail once when opened, then anchors above it", () => {
    const f = fixture(-600);
    const stop = trackNoteFloat(f.origin, "one", f.update, f.dismiss);
    expect(f.scroller.scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 392, behavior: "instant" });
    expect(f.update).toHaveBeenLastCalledWith(expect.objectContaining({ bottom: 220 }));
    expect(f.dismiss).not.toHaveBeenCalled(); stop();
  });
  it("repositions for folds/streaming and follows a newly inserted next-turn boundary", () => {
    const f = fixture();
    const stop = trackNoteFloat(f.origin, "one", f.update, f.dismiss);
    expect(f.observed).toContain(f.rows[2]);
    f.rows[2]!.row.bottom = 450; f.rows[3]!.row.top = 450;
    f.resize(); f.flush();
    expect(f.update).toHaveBeenLastCalledWith(expect.objectContaining({ bottom: 458 }));
    // A new first row appears earlier; the old tail is now part of another turn.
    f.rows[2]!.row.id = "inserted";
    f.mutate(); f.flush();
    expect(f.update).toHaveBeenLastCalledWith(expect.objectContaining({ bottom: 468 }));
    stop(); expect(f.disconnect).toHaveBeenCalled();
  });
  it("dismisses when its source is removed and cleans up pending observers/frames", () => {
    const f = fixture();
    const stop = trackNoteFloat(f.origin, "one", f.update, f.dismiss);
    f.rows[0]!.row.id = null;
    f.mutate(); f.flush();
    expect(f.dismiss).toHaveBeenCalledOnce();
    f.resize(); expect(f.frames.size).toBe(1); stop(); expect(f.frames.size).toBe(0);
  });
  it("ignores hidden empty attachment outlets at the end of a user-only turn", () => {
    const f = fixture();
    f.rows.splice(1);
    f.rows.push({ row: { id: null, top: 0, bottom: 0 }, getAttribute: () => null, getBoundingClientRect: () => ({ id: null, top: 0, bottom: 0, right: 0 }) });
    const stop = trackNoteFloat(f.origin, "one", f.update, f.dismiss);
    expect(f.update).toHaveBeenCalled(); expect(f.dismiss).not.toHaveBeenCalled(); stop();
  });
});
