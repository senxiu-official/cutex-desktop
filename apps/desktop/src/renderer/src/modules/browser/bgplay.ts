// 后台播放 (owner 2026-11-18, D2–D7; D1 = 「我的浏览器」): only an owner tab the owner ticks keeps playing when it is not
// on screen. A ticked tab holds itself mounted (an uncapped hold, like media before) and stays in 正在播放 even
// paused, until its ✕ there (D3). An unticked owner tab that plays is paused a moment after it leaves the screen.
// Ticks live in memory only: nothing resumes after quitting (D7). Hidden playing tabs keep Chromium's background
// throttling (sound plays, video is not decoded). No ⏮⏭ in the tray (media keys and the Windows flyout do that),
// no system-tray menu line, no DRM. Agent-pool and service tabs keep the 2026-11-10 rule (held while playing).
import { create } from "zustand";
import type { BrowserTabView } from "../../../../shared/browser";
import { browserCacheKey } from "./browserCache";
import type { PlayingTab } from "./media";

export const BGPLAY_PAUSE_DELAY_MS = 1500;
const PAUSED = Object.freeze({ playing: false, audible: false, muted: false });

export const useBgplay = create<{ on: ReadonlySet<string> }>(() => ({ on: new Set() }));

export const isBgplay = (hostId: string, tabKey: string): boolean => useBgplay.getState().on.has(browserCacheKey(hostId, tabKey));
export const useBgplayOn = (hostId: string | null, tabKey: string): boolean => useBgplay((s) => !!hostId && s.on.has(browserCacheKey(hostId, tabKey)));

export function setBgplay(hostId: string, tabKey: string, on: boolean): void {
  const key = browserCacheKey(hostId, tabKey);
  const cur = useBgplay.getState().on;
  if (cur.has(key) === on) return;
  const next = new Set(cur);
  if (on) next.add(key); else next.delete(key);
  useBgplay.setState({ on: next });
}

/** The tick applies to owner browser tabs (an owner identity's pool; not a service page). */
export const bgplayApplies = (view: Pick<BrowserTabView, "pool" | "url"> | undefined, url: string): boolean =>
  view?.pool !== "agent" && !(view?.url ?? url).startsWith("cutex:service/");

/** What the Body does with a page that plays: hold it (ticked), pause it when it leaves the screen (unticked owner
 *  tab), or the old rule (agent-pool / service tab: held while playing, with the grace). */
export function bgplayMode(applies: boolean, ticked: boolean): "hold" | "pauseWhenHidden" | "legacy" {
  return !applies ? "legacy" : ticked ? "hold" : "pauseWhenHidden";
}

/** 正在播放's rows: pages that play now, and every ticked tab (paused or not yet playing: it stays until ✕). The
 *  view cache drops `media` once a page is silent and paused, so a ticked row stands in a paused one. */
export function trayTabs(views: Iterable<Readonly<BrowserTabView>>, ticked: ReadonlySet<string>): (PlayingTab & { ticked: boolean })[] {
  const out: (PlayingTab & { ticked: boolean })[] = [];
  for (const v of views) {
    const on = ticked.has(browserCacheKey(v.hostId, v.tabKey));
    if (!on && !(v.media?.playing || v.media?.audible)) continue;
    out.push({ hostId: v.hostId, tabKey: v.tabKey, title: v.title, url: v.url, media: v.media ?? PAUSED, ticked: on, ...(v.browserIdentityId ? { browserIdentityId: v.browserIdentityId } : {}) });
  }
  return out;
}
