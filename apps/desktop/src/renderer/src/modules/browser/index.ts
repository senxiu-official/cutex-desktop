import { Globe } from "lucide-react";
import { defineModule } from "../slots";
import { BrowserActions, BrowserBody } from "./BrowserBody";
import { BROWSER_TAB, browserRef, initBrowser, parseBrowserParams, restoreBrowser } from "./browserState";
import { closeBrowser, startBrowser } from "./runtime";
import { useBrowserTab } from "./tabs";
import { BrowserToolRow, BrowserTurnAttachment } from "./BrowserTimelineViews";
import { browserShotStandalone, isBrowserTool } from "./browserTimeline";
import { lazyPage } from "../../lib/lazyPage";

// Loaded on first open (lib/lazyPage).
const BrowserSettings = lazyPage(() => import("./BrowserSettings").then((m) => m.BrowserSettings));

export default defineModule({
  id: "browser",
  titleKey: "browser.title",
  descriptionKey: "browser.description",
  // On by default since 2026-10-15 (fresh installs; was off since the I2a checkpoint). Installs that
  // already saved module choices keep it off (modules/defaultFlips.ts).
  contributes: {
    // A call that came back with a screenshot is its own row (standalone): folded into a work group's one line, the
    // picture would vanish when the next step arrives and the history above would jump (owner 2026-10-24).
    "timeline.tool": [{ id: "browser.tool", order: 150, match: isBrowserTool, Row: BrowserToolRow, standalone: browserShotStandalone }],
    "timeline.turnAttachment": [{ id: "browser.turnShots", order: 300, margin: { side: "right", minWidth: 200 }, Attachment: BrowserTurnAttachment }],
    // Its own page under 工具 (owner 2026-10-15: browser permissions did not belong on 对话).
    "settings.page": [{ id: "browser.settings", page: "browser", group: "tools", order: 50, icon: Globe, titleKey: "browser.title", source: null, hostPart: true, Page: BrowserSettings,
      keywords: ["browser.settingsHint", "browser.hiddenTarget", "browser.hiddenTargetHint", "browser.viewportWidth", "browser.viewportHeight", "browser.viewportHint", "browser.idleDetach", "browser.idleDetachHint", "browser.host.approval", "browser.hold.limit", "browser.externalPages.label", "browser.desktopLoopback.label", "browser.claim.allows", "browser.claim.audit"],
      sections: [{ anchor: "site-permissions", titleKey: "browser.sitePermissions.title", keywords: ["browser.sitePermissions.hint", "browser.sitePermissions.forgetAll", "browser.sitePermissions.forget"] }, { anchor: "site-origins", titleKey: "browser.origins.reset", keywords: ["browser.origins.resetHint"] }] }],
    "side.component": [{
      id: BROWSER_TAB,
      titleKey: "browser.title",
      icon: Globe,
      instances: "multi",
      defaultBinding: "host",
      keepAlive: "hidden",
      placement: { home: "browser", order: 100 },
      parseParams: parseBrowserParams,
      init: initBrowser,
      restore: restoreBrowser,
      toRef: browserRef,
      fromRef: (params) => parseBrowserParams({ url: params.url ?? "" }),
      useTab: useBrowserTab,
      Body: BrowserBody,
      Actions: BrowserActions,
      // Chrome-like: the tab row shows with one tab too, ＋ = a new blank owner tab in this card.
      tabRow: "always",
      onClose: (instance) => closeBrowser(instance.binding.hostId, instance.state.tabKey),
      launcher: { order: 700, pin: "default", params: () => ({ url: "about:blank" }) },
    }],
  },
  activate: startBrowser,
});
