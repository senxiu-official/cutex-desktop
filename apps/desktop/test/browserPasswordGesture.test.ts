// The owner-gesture clock of saved passwords (main/browser/passwords/gesture.ts) and the Hello key's cache-policy read-back.
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createOwnerGestures, OWNER_GESTURE_MS } from "../src/main/browser/passwords/gesture";
import { readNgcCacheType } from "../src/main/browser/passwords/win32";

describe("owner gestures", () => {
  it("a native press or key on an app window allows one secret operation, briefly", () => {
    let now = 1000;
    const gestures = createOwnerGestures(() => now);
    const contents = new EventEmitter();
    const win = { id: 1 } as never;
    const stop = gestures.listen(contents as never, win);
    expect(gestures.consume()).toBeNull();
    contents.emit("before-mouse-event", {}, { type: "mouseMove" });
    expect(gestures.consume()).toBeNull();
    contents.emit("before-mouse-event", {}, { type: "mouseDown" });
    contents.emit("before-mouse-event", {}, { type: "mouseUp" });
    expect(gestures.consume()).toEqual({ window: win });
    expect(gestures.consume()).toBeNull(); // used up
    contents.emit("before-input-event", {}, { type: "keyDown", key: "Enter", isAutoRepeat: true });
    expect(gestures.consume()).toBeNull();
    contents.emit("before-input-event", {}, { type: "keyDown", key: "Enter" });
    now += OWNER_GESTURE_MS + 1;
    expect(gestures.consume()).toBeNull(); // too old
    stop();
    contents.emit("before-mouse-event", {}, { type: "mouseDown" });
    expect(gestures.consume()).toBeNull();
  });
});

describe("Hello key cache policy read-back", () => {
  it("reads NgcCacheType, falls back to the older name, null when neither reads", () => {
    const reader = (values: Record<string, number>) => (name: string, out: Buffer, size: Buffer) => {
      if (!(name in values)) return 0x80090029 | 0;
      out.writeUInt32LE(values[name]!, 0); size.writeUInt32LE(4, 0); return 0;
    };
    expect(readNgcCacheType(reader({ NgcCacheType: 1 }))).toBe(1);
    expect(readNgcCacheType(reader({ NgcCacheTypeProperty: 0 }))).toBe(0);
    expect(readNgcCacheType(reader({}))).toBeNull();
  });
});
