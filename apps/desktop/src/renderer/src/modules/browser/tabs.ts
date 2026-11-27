import { useSyncExternalStore } from "react";
import { useI18n } from "../../i18n";
import type { SideTabInfo, SideTabProps } from "../slots";
import { browserCache } from "./browserCache";
import type { BrowserState } from "./browserState";
import { browserActivation } from "./activation";
import { bridge } from "../../bridge";
import { createElement } from "react";
import { identityColor, useIdentity } from "./identities";
import { Avatar } from "../../components/Avatar";
import { useHostServices } from "../../lib/serviceLinkView";
import { serviceSlugOf } from "../../lib/serviceLink";

export function useBrowserEnabled(): boolean {
  return useSyncExternalStore(browserActivation.subscribe, browserActivation.get, browserActivation.get);
}

export function useBrowserView(hostId: string | null, tabKey: string) {
  const snapshot = () => hostId ? browserCache.get(hostId, tabKey) : undefined;
  return useSyncExternalStore(browserCache.subscribe, snapshot, snapshot);
}

/** This hook is also called for hidden tabs. Only reads passive metadata; never subscribes to IPC. */
export function useBrowserTab({ instance, hostId }: SideTabProps<BrowserState>): SideTabInfo {
  const { t } = useI18n();
  const view = useBrowserView(hostId, instance.state.tabKey);
  // Main owns the operation's linger window. No renderer timer, attach or polling here.
  const media = view?.media;
  // The tab's speaker while its page plays or sounds (or stays muted): a click mutes / unmutes it in main.
  const audio = media && (media.playing || media.audible) && hostId
    ? { muted: media.muted, toggleMute: () => void bridge.browser?.forHost(hostId).setMuted(instance.state.tabKey, !media.muted).catch(() => {}) } : undefined;
  // 浏览器身份: the tab is tinted with its identity's colour (the default identity: untinted); its favicon stays.
  const identity = useIdentity(view?.browserIdentityId);
  const tint = view?.pool !== "agent" ? identityColor(identity) : undefined;
  // Granted to an agent: its small avatar after the title (the favicon stays the site's).
  const grantee = view?.control?.grantee;
  const trailing = grantee ? createElement("span", { className: "shrink-0", title: t("browser.maid.granted", { name: grantee }), "data-side-tab-grantee": "" }, createElement(Avatar, { name: grantee, seed: grantee, size: 13 })) : undefined;
  const tooltip = [view?.url ?? instance.state.url, identity && !identity.isDefault ? t("browser.identity.tabTooltip", { name: identity.name }) : ""].filter(Boolean).join("\n");
  return { title: view?.title || instance.state.title || t("browser.title"), tooltip, busy: view?.loading || view?.control?.operating || undefined, ...(view?.favicon ? { favicon: view.favicon } : {}), ...(audio ? { audio } : {}), ...(tint ? { tint } : {}), ...(trailing ? { trailing } : {}) };
}

export function useServiceTab(props: SideTabProps<BrowserState>) {
  const { t } = useI18n();
  const info = useBrowserTab(props);
  const list = useHostServices(props.hostId);
  const slug = serviceSlugOf(props.instance.state.url);
  const service = slug ? list?.find(s => s.slug === slug) : null;
  return { ...info, title: service?.displayName || slug || (props.instance.state.url === "about:blank" ? t("browser.service.title") : info.title) };
}
