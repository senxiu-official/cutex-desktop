// @vitest-environment jsdom
// A tab playing sound stays alive in the background (owner 2026-11-10, 「完全不用限制」): the media hold beside the
// lease hold, the 10-minute grace after a pause, 停止, and which agents' rows show a speaker.
import { describe, expect, it, vi } from "vitest";
import { agentAudioOf, createHoldReasons, createMediaHold, MEDIA_GRACE_MS, playingTabs } from "../src/renderer/src/modules/browser/media";

describe("createHoldReasons", () => {
  it("one shell hold for the lease and the media; only the media one is uncapped", () => {
    const keep = vi.fn((hold: boolean) => hold);
    const mark = vi.fn();
    const r = createHoldReasons(keep, mark);
    expect(r.set("lease", true)).toBe(true);
    expect(keep).toHaveBeenLastCalledWith(true); expect(mark).toHaveBeenLastCalledWith(false);
    r.set("media", true);
    expect(keep).toHaveBeenLastCalledWith(true); expect(mark).toHaveBeenLastCalledWith(true);
    // The lease ends: the media still holds (the page keeps playing).
    r.set("lease", false);
    expect(keep).toHaveBeenLastCalledWith(true); expect(mark).toHaveBeenLastCalledWith(true);
    r.set("media", false);
    expect(keep).toHaveBeenLastCalledWith(false); expect(mark).toHaveBeenLastCalledWith(false);
  });
});

describe("createMediaHold", () => {
  it("holds while playing, keeps the grace after a pause, releases after it; a play inside it continues the hold", () => {
    vi.useFakeTimers();
    try {
      const hold = vi.fn();
      const m = createMediaHold(hold);
      m.update(false);
      expect(hold).not.toHaveBeenCalled();
      m.update(true);
      expect(hold).toHaveBeenLastCalledWith(true);
      m.update(false);
      vi.advanceTimersByTime(MEDIA_GRACE_MS - 1);
      expect(hold).toHaveBeenLastCalledWith(true);
      m.update(true);
      vi.advanceTimersByTime(MEDIA_GRACE_MS * 2);
      expect(hold).toHaveBeenLastCalledWith(true);
      m.update(false);
      vi.advanceTimersByTime(MEDIA_GRACE_MS);
      expect(hold).toHaveBeenLastCalledWith(false);
      expect(MEDIA_GRACE_MS).toBe(10 * 60_000);
    } finally { vi.useRealTimers(); }
  });
  it("停止 releases at once and stays released while the page still plays, until it starts again", () => {
    vi.useFakeTimers();
    try {
      const hold = vi.fn();
      const m = createMediaHold(hold);
      m.update(true);
      m.stop();
      expect(hold).toHaveBeenLastCalledWith(false);
      m.update(true); // still playing (e.g. Web Audio the pause script could not reach)
      expect(hold).toHaveBeenLastCalledWith(false);
      m.update(false); m.update(true);
      expect(hold).toHaveBeenLastCalledWith(true);
      m.dispose();
      vi.advanceTimersByTime(MEDIA_GRACE_MS * 2);
      expect(hold).toHaveBeenLastCalledWith(true);
    } finally { vi.useRealTimers(); }
  });
});

describe("playingTabs / agentAudioOf", () => {
  const view = (tabKey: string, media?: { playing: boolean; audible: boolean; muted: boolean }, title = tabKey) =>
    ({ hostId: "local", tabKey, title, url: `http://x/${tabKey}`, media }) as never;
  it("lists the tabs that play or sound, and marks each agent's row (muted only when all its tabs are)", () => {
    const tabs = playingTabs([view("a", { playing: true, audible: true, muted: false }), view("b"), view("c", { playing: false, audible: false, muted: true }),
      view("d", { playing: true, audible: false, muted: true }), view("e", { playing: false, audible: true, muted: false })]);
    expect(tabs.map((t) => t.tabKey)).toEqual(["a", "d", "e"]);
    const where: Record<string, string | null> = { a: "local|s1", d: "local|s1", e: "local|s2" };
    expect(agentAudioOf(tabs, (tab) => where[tab.tabKey] ?? null)).toEqual({ "local|s1": "playing", "local|s2": "playing" });
    expect(agentAudioOf(tabs.filter((t) => t.tabKey === "d"), (tab) => where[tab.tabKey] ?? null)).toEqual({ "local|s1": "muted" });
  });
});
