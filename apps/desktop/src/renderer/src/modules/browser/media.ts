// A tab that plays sound stays alive in the background (owner 2026-11-10, 「完全不用限制，反正我内存多」): while main
// says its page plays (BrowserTabView.media, Chromium's own events), the tab holds itself mounted — an uncapped hold
// (lib/sideKeep markUncappedHold) beside the agent lease's hold — and keeps it MEDIA_GRACE_MS after a pause, so a
// paused song keeps its place. 停止 (正在播放, MediaTrayButton) pauses the page and lets the hold go at once.
// Tabs that play nothing behave as before (LRU, unmount when not shown).
import type { BrowserTabView } from "../../../../shared/browser";
import { setAgentAudio, type AgentAudio } from "../../lib/agentAudio";
import { findInstanceInAnyShelf, useSide } from "../../lib/sideLayoutStore";
import { browserCache, browserCacheKey } from "./browserCache";
import { isBrowserKind } from "./browserState";

export const MEDIA_GRACE_MS = 10 * 60_000;

type HoldReason = "lease" | "media";

/** The Body's one shell hold for two reasons: the agent lease (counted) and media (uncapped). Returns held-after. */
export function createHoldReasons(keepMounted: (hold: boolean) => boolean, markUncapped: (on: boolean) => void) {
  const on: Record<HoldReason, boolean> = { lease: false, media: false };
  return {
    set(reason: HoldReason, hold: boolean): boolean {
      on[reason] = hold;
      markUncapped(on.media);
      return keepMounted(on.lease || on.media);
    },
  };
}

/** Media hold of one tab: `hold(true)` while playing, `hold(false)` MEDIA_GRACE_MS after it stops or at once on stop(). */
export function createMediaHold(hold: (on: boolean) => void) {
  let held = false;
  let playing = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { if (timer !== undefined) { clearTimeout(timer); timer = undefined; } };
  const set = (on: boolean) => { if (held !== on) { held = on; hold(on); } };
  return {
    update(now: boolean) {
      if (now && !playing) stopped = false; // a new start after 停止 holds again
      playing = now;
      if (stopped) return;
      if (now) { clear(); set(true); return; }
      if (held && timer === undefined) timer = setTimeout(() => { timer = undefined; set(false); }, MEDIA_GRACE_MS);
    },
    stop() { clear(); stopped = true; set(false); },
    dispose() { clear(); },
  };
}

export type PlayingTab = Pick<BrowserTabView, "hostId" | "tabKey" | "title" | "url"> & { media: NonNullable<BrowserTabView["media"]> };

/** The tabs whose pages play or sound now (main's state), in the given order. */
export function playingTabs(views: Iterable<Readonly<BrowserTabView>>): PlayingTab[] {
  const out: PlayingTab[] = [];
  for (const v of views) if (v.media && (v.media.playing || v.media.audible)) out.push({ hostId: v.hostId, tabKey: v.tabKey, title: v.title, url: v.url, media: v.media });
  return out;
}

/** convKey → speaker of the agents whose own Shelf holds a playing tab (muted when all of its playing tabs are). */
export function agentAudioOf(tabs: readonly PlayingTab[], convOf: (tab: PlayingTab) => string | null): Record<string, AgentAudio> {
  const out: Record<string, AgentAudio> = {};
  for (const tab of tabs) {
    const conv = convOf(tab);
    if (!conv) continue;
    if (!tab.media.muted || !out[conv]) out[conv] = tab.media.muted ? (out[conv] ?? "muted") : "playing";
  }
  return out;
}

/** The side instance of a browser tab in any Shelf of this window, with its conversation (null: none / shared). */
export function mediaTabPlace(hostId: string, tabKey: string): { id: string; conv: string | null } | null {
  return findInstanceInAnyShelf((inst) => {
    const st = inst.state as { tabKey?: unknown } | null;
    return isBrowserKind(inst.kind) && inst.binding.hostId === hostId && !!st && typeof st === "object" && st.tabKey === tabKey;
  });
}

// ── 停止 from 正在播放 to the tab's Body ─────────────────────────────────────────────────────────

const stops = new Map<string, Set<() => void>>();
export function onMediaStop(hostId: string, tabKey: string, fn: () => void): () => void {
  const key = browserCacheKey(hostId, tabKey);
  const set = stops.get(key) ?? new Set();
  stops.set(key, set);
  set.add(fn);
  return () => { set.delete(fn); if (!set.size) stops.delete(key); };
}
export function requestMediaStop(hostId: string, tabKey: string): void {
  for (const fn of stops.get(browserCacheKey(hostId, tabKey)) ?? []) fn();
}

/** Keeps the sidebar's speakers (lib/agentAudio) in step with main's media state and where the tabs are. */
export function watchBrowserMedia(): () => void {
  const sync = () => {
    const tabs = playingTabs(browserCache.all());
    setAgentAudio(agentAudioOf(tabs, (tab) => mediaTabPlace(tab.hostId, tab.tabKey)?.conv ?? null));
  };
  const offCache = browserCache.subscribe(sync);
  const offSide = useSide.subscribe((s, prev) => { if (s.layout !== prev.layout || s.peers !== prev.peers) sync(); });
  sync();
  return () => { offCache(); offSide(); setAgentAudio({}); };
}
