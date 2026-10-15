import { useSyncExternalStore } from "react";
import { useI18n } from "../../i18n";
import type { SideTabInfo, SideTabProps } from "../slots";
import { browserCache } from "./browserCache";
import type { BrowserState } from "./browserState";
import { browserActivation } from "./activation";

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
  return { title: view?.title || instance.state.title || t("browser.title"), tooltip: view?.url ?? instance.state.url, busy: view?.loading || view?.control?.operating || undefined };
}
