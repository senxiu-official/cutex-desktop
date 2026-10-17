import { bridge } from "../../bridge";
import type { AppModuleContext } from "../slots";
import { browserCache } from "./browserCache";
import { BROWSER_TAB, browserNavigationUrl, browserTitle, isBrowserTabKey } from "./browserState";
import { guestLifecycle } from "./guestLifecycle";
import { browserActivation } from "./activation";
import { browserHostCurrent, watchBrowserHosts } from "./hosts";
import { createBrowserAgentOpens } from "./agentOpen";
import { agentHost, useApp } from "../../store";
import { translate } from "../../i18n";
import type { BrowserEvent } from "../../../../shared/browser";
import { browserSitePermissionList } from "./sitePermissionText";
import { openClaimTab } from "./claimOpen";

/** A preview intentionally has no browser bridge, hence no real webview or website requests. */
export async function startBrowser(context: AppModuleContext): Promise<void> {
  const browser = bridge.browser;
  if (!browser || context.signal.aborted) return;
  const activation = browserActivation.begin();
  const opens = createBrowserAgentOpens({ side: context.services.side,
    isSelected: (hostId, sessionId) => { const state = useApp.getState(); return state.selectedId === sessionId && agentHost(state) === hostId; },
    refused: (intent, code) => browser.forHost(intent.hostId).openRefused(intent.requestId, code),
  });
  let off = () => {};
  // Register before the async enable call so disabling during activation still revokes main's
  // latch immediately. Static slots can render before activation settles; Body reads our gate.
  context.signal.addEventListener("abort", () => {
    off();
    opens.dispose();
    if (!browserActivation.end(activation)) return;
    browserCache.clear();
    void browser.setEnabled(false).catch(() => {});
  }, { once: true });
  await browser.setEnabled(true);
  if (context.signal.aborted) return;
  const offHosts = watchBrowserHosts((hostId, epoch) => opens.invalidateHost(hostId, epoch));
  const offBrowser = browser.subscribe((event) => {
    if (context.signal.aborted || !browserHostCurrent(event.hostId, event.epoch)) return;
    // Rejected popup diagnostics are for developers, not owner-facing tab state or notifications.
    if (event.kind === "diagnostic") return;
    // Something main stopped on its own (popup / download without your action): say it once.
    if (event.kind === "blocked") {
      const agent = browserTitle(event.lease?.agentName ?? "");
      if (event.blocked === "popup") context.services.ui.notice(translate("browser.blocked.popup"));
      else if (event.blocked === "download") context.services.ui.notice(translate("browser.blocked.download"));
      else if (event.blocked === "download-hidden") context.services.ui.notice(translate("browser.blocked.downloadHidden", { name: agent }));
      else if (event.sitePermission && (event.blocked === "permission-waiting" || event.blocked === "permission-hidden" || event.blocked === "permission-timeout")) {
        const key = event.blocked === "permission-waiting" ? "browser.blocked.permissionWaiting" : event.blocked === "permission-hidden" ? "browser.blocked.permissionHidden" : "browser.blocked.permissionTimeout";
        context.services.ui.notice(translate(key, { origin: browserTitle(event.sitePermission.origin), permissions: browserSitePermissionList(event.sitePermission.permissions) }));
      }
      return;
    }
    if (event.kind === "agent-open") { if (event.openIntent) opens.open(event.openIntent); return; }
    if (event.kind === "agent-open-cancel") { if (event.openRequestId) opens.cancelled(event.hostId, event.openRequestId); return; }
    if (event.kind === "agent-open-confirm") { if (event.openRequestId) opens.confirmed(event.hostId, event.openRequestId); }
    // Main opens a claim's local page in an owner tab and grants it once attached (main-reserved key).
    if (event.kind === "claim-open") { if (event.claimOpen) openClaimTab(context.services.side, event.hostId, event.epoch, event.claimOpen, browserCache.get); return; }
    if (event.kind === "claim-granted") { if (browserCache.update(event)) claimGrantedNotice(context, event); return; }
    if (!browserCache.update(event)) return;
    if (event.kind === "reveal") {
      // list() is already limited to the current scope. Reveal only this existing host-bound
      // instance: never open a replacement, switch scope, focus a card or restore the OS window.
      const target = context.services.side.list(BROWSER_TAB).find((instance) => instance.state && typeof instance.state === "object" && !Array.isArray(instance.state) && instance.state.tabKey === event.tabKey
        && (instance.binding.kind === "host" || instance.binding.kind === "agent") && instance.binding.hostId === event.hostId);
      if (target) context.services.side.reveal({ instanceId: target.id });
      return;
    }
    if (event.kind === "new-tab") {
      const url = browserNavigationUrl(event.newTabUrl);
      if (!url || !/^https?:/.test(url) || (event.pool === "agent" && !isBrowserTabKey(event.newTabKey))) return;
      // Main minted the new tab's key in the opener's pool (and holds the exact URL / form body for it).
      const params: Record<string, string | boolean> = event.pool === "agent" ? { url, tabKey: event.newTabKey!, agentOpened: true }
        : isBrowserTabKey(event.newTabKey) ? { url, tabKey: event.newTabKey, ownerTab: true } : { url };
      context.services.side.open(BROWSER_TAB, params, { binding: { kind: "host", hostId: event.hostId }, focus: false });
      if (event.newTabAgent) context.services.ui.notice(translate(event.newTabGranted ? "browser.newTab.agentGranted" : "browser.newTab.agent", { name: browserTitle(event.lease?.agentName ?? "") }));
    }
  });
  off = () => { offHosts(); offBrowser(); };
  browserActivation.complete(activation);
}

export async function closeBrowser(hostId: string, tabKey: string): Promise<boolean> {
  if (bridge.browser) await guestLifecycle.close(hostId, tabKey, bridge.browser.forHost(hostId));
  browserCache.remove(hostId, tabKey);
  return true;
}

/** Main granted a claim by itself (local page / 一直允许 / Profile always): tell the owner, never silently. */
function claimGrantedNotice(context: AppModuleContext, event: BrowserEvent): void {
  if (!event.claimGrant) return;
  const reason = translate(`browser.claim.reason.${event.claimGrant.reason}` as Parameters<typeof translate>[0]);
  // The cache holds the sanitized title / URL (no query secrets, no control characters).
  const view = browserCache.get(event.hostId, event.tabKey);
  context.services.ui.notice(translate("browser.claim.toast", { tab: view?.title || view?.url || "", name: browserTitle(event.claimGrant.agentName), reason }));
}

