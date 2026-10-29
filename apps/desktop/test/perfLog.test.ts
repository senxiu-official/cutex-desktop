// @vitest-environment jsdom
// 性能记录 (#27, docs/design/018-perf-log.md): the recorder's pure parts — what makes an entry, how one stall's
// frames merge, the per-entry budget, what is kept of the last action (never typed text), and the settings'
// time windows. IndexedDB is absent in jsdom: entries stay unwritten, which is what these tests read.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeTarget, fitEntry, keyName, MAX_ENTRY_BYTES, mergeScripts, noteStall, scriptsOf, STALL_MS, unwrittenEntries, type PerfEntry } from "../src/renderer/src/modules/perf-log/recorder";
import { rangeWindow } from "../src/renderer/src/modules/perf-log/PerfLogSettings";

const frame = (startTime: number, duration: number, scripts: { invoker: string; duration: number; sourceURL?: string; sourceCharPosition?: number; forcedStyleAndLayoutDuration?: number }[] = []) =>
  ({ name: "long-animation-frame", entryType: "long-animation-frame", startTime, duration, scripts, toJSON() {} }) as unknown as PerformanceEntry;

describe("noteStall", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ignores frames up to the threshold; one entry per stall, its frames merged", () => {
    const before = unwrittenEntries().length;
    noteStall(frame(1000, STALL_MS), "frame");
    expect(unwrittenEntries().length).toBe(before);
    noteStall(frame(2000, 180, [{ invoker: "HTMLButtonElement.onclick", duration: 150, sourceURL: "http://x/assets/index-abc.js?v=1", sourceCharPosition: 4242, forcedStyleAndLayoutDuration: 30 }]), "frame");
    noteStall(frame(2500, 240, [{ invoker: "HTMLButtonElement.onclick", duration: 90, sourceURL: "http://x/assets/index-abc.js", sourceCharPosition: 4242 }, { invoker: "ResizeObserverCallback", duration: 120 }]), "frame");
    const merged = unwrittenEntries().at(-1)!;
    expect(merged).toMatchObject({ ms: 240, frames: 2, totalMs: 420, source: "frame" });
    expect(merged.scripts[0]).toEqual({ what: "HTMLButtonElement.onclick", src: "index-abc.js:4242", ms: 240, layoutMs: 30 });
    // A frame more than a second after the last one is a new stall.
    noteStall(frame(2740 + 1500, 130), "frame");
    expect(unwrittenEntries().at(-1)).toMatchObject({ ms: 130, frames: 1 });
    expect(unwrittenEntries().length).toBe(before + 2);
  });
});

describe("entry budget", () => {
  it("drops scripts, then cuts long strings, to stay within MAX_ENTRY_BYTES", () => {
    const long = "x".repeat(3000);
    const e: PerfEntry = { at: 0, ms: 200, frames: 1, totalMs: 200, layoutMs: 0, source: "frame", scripts: Array.from({ length: 5 }, (_, i) => ({ what: long + i, src: long, ms: 10, layoutMs: 0 })), action: { type: "pointerdown", target: long, agoMs: 1 }, screen: null };
    const fitted = fitEntry(e);
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(MAX_ENTRY_BYTES);
    expect(fitted.scripts.length).toBeGreaterThan(0);
  });
  it("mergeScripts adds up the same code and keeps the top five", () => {
    const s = (what: string, ms: number) => ({ what, src: null, ms, layoutMs: 1 });
    expect(mergeScripts([s("a", 5), s("b", 50)], [s("a", 60), s("c", 1), s("d", 2), s("e", 3), s("f", 4)]).map((x) => [x.what, x.ms])).toEqual([["a", 65], ["b", 50], ["f", 4], ["e", 3], ["d", 2]]);
  });
  it("scriptsOf names the invoker and the function once", () => {
    const [x] = scriptsOf({ startTime: 0, duration: 200, scripts: [{ invoker: "TimerHandler:setTimeout", sourceFunctionName: "tick", duration: 120 }] } as never);
    expect(x).toEqual({ what: "TimerHandler:setTimeout tick", src: null, ms: 120, layoutMs: 0 });
  });
});

describe("the last action", () => {
  it("keeps keys, never typed text", () => {
    const k = (key: string, m: Partial<KeyboardEvent> = {}) => keyName({ key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...m });
    expect(k("a")).toBe("typing");
    expect(k("你")).toBe("typing");
    expect(k("A", { shiftKey: true })).toBe("typing");
    expect(k("1", { altKey: true })).toBe("Alt+1");
    expect(k("k", { ctrlKey: true })).toBe("Ctrl+K");
    expect(k("Enter")).toBe("Enter");
    expect(k("Tab", { shiftKey: true })).toBe("Shift+Tab");
  });
  it("names a control by its label or text, a field by its label (never its value)", () => {
    document.body.innerHTML = `<button aria-label="停止"><svg><path id="p"/></svg></button><div id="plain" data-x="1">a lot of message content</div><textarea id="t" placeholder="继续输入">secret draft</textarea><div role="tab" id="tab">浏览器</div>`;
    expect(describeTarget(document.getElementById("p"))).toBe("button 「停止」");
    expect(describeTarget(document.getElementById("plain"))).toBe("div[data-x=1]");
    expect(describeTarget(document.getElementById("t"))).toBe("textarea 「继续输入」");
    expect(describeTarget(document.getElementById("tab"))).toBe("div 「浏览器」");
  });
});

describe("time windows (Settings → 关于 → 性能记录)", () => {
  it("a chosen moment shows 10 minutes either side", () => {
    const at = new Date(2026, 9, 21, 22, 40).getTime();
    expect(rangeWindow("custom", at + 3_600_000, at)).toEqual([at - 600_000, at + 600_000]);
    expect(rangeWindow("15m", 1_000_000, null)).toEqual([100_000, 1_000_000]);
    const [from] = rangeWindow("today", at, null);
    expect(new Date(from).getHours()).toBe(0);
    expect(rangeWindow("all", at, null)[1]).toBe(Number.POSITIVE_INFINITY);
  });
});
