// 正在播放 (owner 2026-11-10): a speaker at the end of the tray while a browser / service tab plays sound; its list
// mutes / unmutes, stops (main pauses the page; the tab's background hold ends) or goes to each tab. Nothing plays:
// nothing shows.
import { useMemo, useSyncExternalStore } from "react";
import { Pause, Volume2, VolumeX, X } from "lucide-react";
import { Popover } from "../../components/Menu";
import { useI18n } from "../../i18n";
import { bridge } from "../../bridge";
import { parseConvKey } from "../../lib/convShelves";
import { instanceOwner, liveConversation } from "../../lib/sideLayoutStore";
import { useAgentNames } from "../../lib/delegationsView";
import { useApp } from "../../store";
import { services } from "../app";
import { browserCache } from "./browserCache";
import { mediaTabPlace, requestMediaStop, type PlayingTab } from "./media";
import { bgplayApplies, setBgplay, trayTabs, useBgplay } from "./bgplay";
import { revealBrowserTab } from "./popupOpen";
import { identityColor, useIdentity } from "./identities";
import type { CSSProperties } from "react";

/** A stable text of what plays (the snapshot useSyncExternalStore compares). */
const playingKey = () => JSON.stringify(trayTabs(browserCache.all(), useBgplay.getState().on).map((t) => [t.hostId, t.tabKey, t.title, t.url, t.media.muted, t.media.playing || t.media.audible, t.ticked, t.browserIdentityId ?? ""]));
const subscribeTray = (fn: () => void) => { const a = browserCache.subscribe(fn), b = useBgplay.subscribe(fn); return () => { a(); b(); }; };

export function MediaTrayButton() {
  const { t } = useI18n();
  const key = useSyncExternalStore(subscribeTray, playingKey, playingKey);
  const tabs = useMemo(() => (key === "[]" ? [] : trayTabs(browserCache.all(), useBgplay.getState().on)), [key]);
  const names = useAgentNames();
  if (!tabs.length) return null;
  const allMuted = tabs.every((tab) => tab.media.muted || !(tab.media.playing || tab.media.audible));
  const label = t("browser.media.tray");
  return (
    <Popover
      align="right"
      width="w-80"
      triggerClassName="tray-item"
      triggerTitle={label}
      triggerLabel={label}
      trigger={<span data-tray-item="" data-browser-media-tray={allMuted ? "muted" : "playing"} className="flex">{allMuted ? <VolumeX size={16} aria-hidden /> : <Volume2 size={16} aria-hidden />}</span>}
    >
      {(close) => (
        <div className="flex flex-col gap-1 p-1" data-browser-media-list="">
          <div className="px-2 pt-1 text-xs font-medium text-foreground">{t("browser.media.title")}</div>
          <p className="px-2 pb-1 text-caption text-subtle">{t("browser.bgplay.hint")}</p>
          {tabs.map((tab) => <MediaRow key={`${tab.hostId}\u0000${tab.tabKey}`} tab={tab} agentName={agentOf(tab, names)} close={close} />)}
        </div>
      )}
    </Popover>
  );
}

function agentOf(tab: PlayingTab, names: (id: string) => string): string | null {
  const conv = mediaTabPlace(tab.hostId, tab.tabKey)?.conv;
  const at = conv ? parseConvKey(conv) : null;
  return at ? names(at.sessionId) : null;
}

const ROW_BUTTON = "shrink-0 rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-hover hover:text-foreground";

function MediaRow({ tab, agentName, close }: { tab: PlayingTab & { ticked: boolean }; agentName: string | null; close(): void }) {
  const { t } = useI18n();
  const api = () => bridge.browser?.forHost(tab.hostId);
  // 浏览器身份: the row has its tab's tint and names the identity (the default one: as before).
  const identity = useIdentity(tab.browserIdentityId);
  const tint = identity && !identity.isDefault ? identityColor(identity) : undefined;
  const sounding = tab.media.playing || tab.media.audible;
  const owner = bgplayApplies(browserCache.get(tab.hostId, tab.tabKey), tab.url);
  return (
    <div className={`flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 ${tint ? "identity-tab" : "hover:bg-hover/50"}`} data-browser-media-row={tab.tabKey} style={tint ? ({ "--tab-tint": tint } as CSSProperties) : undefined}>
      {!sounding ? <Pause size={13} className="shrink-0 text-subtle" aria-label={t("browser.bgplay.paused")} /> : tab.media.muted ? <VolumeX size={13} className="shrink-0 text-subtle" aria-label={t("browser.media.muted")} /> : <Volume2 size={13} className="shrink-0 text-accent" aria-hidden />}
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-xs text-foreground" title={tab.url}>{tab.title || tab.url}</div>
        {(agentName || tint) && <div className="truncate text-caption text-subtle">{[agentName, tint ? identity!.name : null].filter(Boolean).join(" · ")}</div>}
      </div>
      {/* 后台播放 (D2): owner tabs only; agent-pool / service tabs keep playing as before. */}
      {owner && <label className="flex shrink-0 cursor-pointer items-center gap-1 text-xs text-muted" data-browser-bgplay={tab.ticked ? "on" : "off"} title={t("browser.bgplay.tip")}>
        <input type="checkbox" className="accent-[var(--accent)]" checked={tab.ticked} onChange={(e) => setBgplay(tab.hostId, tab.tabKey, e.target.checked)} />
        {t("browser.bgplay.label")}
      </label>}
      {sounding && <button type="button" className={ROW_BUTTON} data-browser-media-mute="" onClick={() => void api()?.setMuted(tab.tabKey, !tab.media.muted).catch(() => {})}>
        {t(tab.media.muted ? "browser.media.unmute" : "browser.media.mute")}
      </button>}
      {sounding && <button type="button" className={ROW_BUTTON} data-browser-media-stop="" onClick={() => { requestMediaStop(tab.hostId, tab.tabKey); void api()?.pauseMedia(tab.tabKey).catch(() => {}); }}>
        {t("browser.media.stop")}
      </button>}
      <button type="button" className={ROW_BUTTON} data-browser-media-go="" onClick={() => { close(); void goToMediaTab(tab); }}>
        {t("browser.media.go")}
      </button>
      {/* D3: a paused ticked tab stays here until ✕ (unticks it; the tab lets its hold go). */}
      {tab.ticked && !sounding && <button type="button" className={`${ROW_BUTTON} px-1`} data-browser-bgplay-remove="" aria-label={t("browser.bgplay.remove")} title={t("browser.bgplay.remove")} onClick={() => setBgplay(tab.hostId, tab.tabKey, false)}>
        <X size={12} aria-hidden />
      </button>}
    </div>
  );
}

/** 前往: the agent whose Shelf holds the tab comes up (when it is not on screen), then the tab is shown where it is. */
export async function goToMediaTab(tab: Pick<PlayingTab, "hostId" | "tabKey">): Promise<void> {
  const place = mediaTabPlace(tab.hostId, tab.tabKey);
  if (!place) return;
  const at = place.conv ? parseConvKey(place.conv) : null;
  if (at && place.conv !== liveConversation() && instanceOwner(place.id) === undefined) await useApp.getState().openAgent(at.sessionId, at.hostId);
  revealBrowserTab(tab, services.side);
}
