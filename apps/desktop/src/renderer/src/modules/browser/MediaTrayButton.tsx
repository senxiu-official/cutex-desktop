// 正在播放 (owner 2026-11-10): a speaker at the end of the tray while a browser / service tab plays sound; its list
// mutes / unmutes, stops (main pauses the page; the tab's background hold ends) or goes to each tab. Nothing plays:
// nothing shows.
import { useMemo, useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { Popover } from "../../components/Menu";
import { useI18n } from "../../i18n";
import { bridge } from "../../bridge";
import { parseConvKey } from "../../lib/convShelves";
import { instanceOwner, liveConversation } from "../../lib/sideLayoutStore";
import { useAgentNames } from "../../lib/delegationsView";
import { useApp } from "../../store";
import { services } from "../app";
import { browserCache } from "./browserCache";
import { mediaTabPlace, playingTabs, requestMediaStop, type PlayingTab } from "./media";
import { revealBrowserTab } from "./popupOpen";

/** A stable text of what plays (the snapshot useSyncExternalStore compares). */
const playingKey = () => JSON.stringify(playingTabs(browserCache.all()).map((t) => [t.hostId, t.tabKey, t.title, t.url, t.media.muted]));

export function MediaTrayButton() {
  const { t } = useI18n();
  const key = useSyncExternalStore(browserCache.subscribe, playingKey, playingKey);
  const tabs = useMemo(() => (key === "[]" ? [] : playingTabs(browserCache.all())), [key]);
  const names = useAgentNames();
  if (!tabs.length) return null;
  const allMuted = tabs.every((tab) => tab.media.muted);
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
          <p className="px-2 pb-1 text-caption text-subtle">{t("browser.media.hint")}</p>
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

function MediaRow({ tab, agentName, close }: { tab: PlayingTab; agentName: string | null; close(): void }) {
  const { t } = useI18n();
  const api = () => bridge.browser?.forHost(tab.hostId);
  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 hover:bg-hover/50" data-browser-media-row={tab.tabKey}>
      {tab.media.muted ? <VolumeX size={13} className="shrink-0 text-subtle" aria-label={t("browser.media.muted")} /> : <Volume2 size={13} className="shrink-0 text-accent" aria-hidden />}
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-xs text-foreground" title={tab.url}>{tab.title || tab.url}</div>
        {agentName && <div className="truncate text-caption text-subtle">{agentName}</div>}
      </div>
      <button type="button" className={ROW_BUTTON} data-browser-media-mute="" onClick={() => void api()?.setMuted(tab.tabKey, !tab.media.muted).catch(() => {})}>
        {t(tab.media.muted ? "browser.media.unmute" : "browser.media.mute")}
      </button>
      <button type="button" className={ROW_BUTTON} data-browser-media-stop="" onClick={() => { requestMediaStop(tab.hostId, tab.tabKey); void api()?.pauseMedia(tab.tabKey).catch(() => {}); }}>
        {t("browser.media.stop")}
      </button>
      <button type="button" className={ROW_BUTTON} data-browser-media-go="" onClick={() => { close(); void goToMediaTab(tab); }}>
        {t("browser.media.go")}
      </button>
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
