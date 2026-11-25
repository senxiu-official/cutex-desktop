// @vitest-environment jsdom
// 后台播放 (owner 2026-11-18, D2–D7): only a ticked owner tab keeps playing off screen and stays in 正在播放 paused
// until ✕; ticks are memory only (no resume after quitting); agent-pool / service tabs keep the 2026-11-10 rule.
// Ctrl+H (⌘Y on macOS) opens 浏览历史 with exact modifiers.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { browserHistoryShortcut, type BrowserTabView } from "../src/shared/browser";
import { bgplayApplies, bgplayMode, isBgplay, setBgplay, trayTabs, useBgplay } from "../src/renderer/src/modules/browser/bgplay";
import { createHoldReasons } from "../src/renderer/src/modules/browser/media";

const view = (over: Partial<BrowserTabView>): BrowserTabView => ({
  hostId: "local", tabKey: "t", title: "Music", url: "https://music.example/", pool: "owner",
  media: { playing: false, audible: false, muted: false }, ...over,
} as unknown as BrowserTabView);

describe("bgplay store", () => {
  beforeEach(() => useBgplay.setState({ on: new Set() }));
  it("ticks per host and tab, in memory only", () => {
    setBgplay("local", "a", true);
    expect(isBgplay("local", "a")).toBe(true);
    expect(isBgplay("other", "a")).toBe(false);
    const before = useBgplay.getState().on;
    setBgplay("local", "a", true);
    expect(useBgplay.getState().on).toBe(before);
    setBgplay("local", "a", false);
    expect(isBgplay("local", "a")).toBe(false);
  });
});

describe("bgplayMode / bgplayApplies", () => {
  it("owner tabs: hold when ticked, pause when hidden otherwise; agent and service tabs keep the old rule", () => {
    expect(bgplayApplies(view({}), "")).toBe(true);
    expect(bgplayApplies(view({ pool: "agent" }), "")).toBe(false);
    expect(bgplayApplies(view({ url: "cutex:service/notes" }), "")).toBe(false);
    expect(bgplayApplies(undefined, "cutex:service/x")).toBe(false);
    expect(bgplayMode(true, true)).toBe("hold");
    expect(bgplayMode(true, false)).toBe("pauseWhenHidden");
    expect(bgplayMode(false, true)).toBe("legacy");
  });
  it("the bgplay hold is uncapped and keeps the tab mounted", () => {
    const keep = vi.fn((hold: boolean) => hold), mark = vi.fn();
    const r = createHoldReasons(keep, mark);
    r.set("bgplay", true);
    expect(keep).toHaveBeenLastCalledWith(true); expect(mark).toHaveBeenLastCalledWith(true);
    r.set("bgplay", false);
    expect(keep).toHaveBeenLastCalledWith(false); expect(mark).toHaveBeenLastCalledWith(false);
  });
});

describe("trayTabs", () => {
  it("playing tabs, plus every ticked tab, paused ones included (until ✕)", () => {
    const views = [
      view({ tabKey: "playing", media: { playing: true, audible: true, muted: false } }),
      view({ tabKey: "paused-ticked" }),
      view({ tabKey: "paused" }),
      view({ tabKey: "ticked-no-media", media: undefined }),
    ];
    const keys = (s: ReadonlySet<string>) => trayTabs(views, s).map((t) => [t.tabKey, t.ticked]);
    useBgplay.setState({ on: new Set() });
    setBgplay("local", "paused-ticked", true);
    setBgplay("local", "ticked-no-media", true);
    expect(keys(useBgplay.getState().on)).toEqual([["playing", false], ["paused-ticked", true], ["ticked-no-media", true]]);
    // The cache drops `media` for a silent paused page: the row shows as paused.
    expect(trayTabs(views, useBgplay.getState().on).at(-1)!.media).toEqual({ playing: false, audible: false, muted: false });
  });
});

describe("browserHistoryShortcut", () => {
  const k = (o: object) => ({ type: "keyDown", key: "h", code: "KeyH", ...o });
  it("Ctrl+H on Windows/Linux, exact modifiers", () => {
    expect(browserHistoryShortcut(k({ control: true }), "win32")).toBe(true);
    expect(browserHistoryShortcut(k({ control: true, type: "rawKeyDown" }), "linux")).toBe(true);
    expect(browserHistoryShortcut(k({ control: true, type: "keyUp" }), "win32")).toBe(false);
    expect(browserHistoryShortcut(k({ control: true, shift: true }), "win32")).toBe(false);
    expect(browserHistoryShortcut(k({ control: true, alt: true }), "win32")).toBe(false);
    expect(browserHistoryShortcut(k({ control: true, meta: true }), "win32")).toBe(false);
    expect(browserHistoryShortcut(k({}), "win32")).toBe(false);
    expect(browserHistoryShortcut({ type: "keyDown", key: "ㅗ", code: "KeyH", control: true }, "win32")).toBe(true);
  });
  it("⌘Y on macOS", () => {
    expect(browserHistoryShortcut({ type: "keyDown", key: "y", code: "KeyY", meta: true }, "darwin")).toBe(true);
    expect(browserHistoryShortcut(k({ control: true }), "darwin")).toBe(false);
  });
});
