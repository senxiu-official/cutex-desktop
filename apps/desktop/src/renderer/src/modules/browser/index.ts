import { Globe } from "lucide-react";
import { defineModule } from "../slots";
import { BrowserActions, BrowserBody } from "./BrowserBody";
import { BROWSER_TAB, browserRef, initBrowser, parseBrowserParams, restoreBrowser } from "./browserState";
import { closeBrowser, startBrowser } from "./runtime";
import { useBrowserTab } from "./tabs";
import { BrowserSettings } from "./BrowserSettings";
import { BrowserToolRow, BrowserTurnAttachment } from "./BrowserTimelineViews";
import { isBrowserTool } from "./browserTimeline";

export default defineModule({
  id: "browser",
  titleKey: "browser.title",
  descriptionKey: "browser.description",
  // On by default since 2026-10-15 (fresh installs; was off since the I2a checkpoint). Installs that
  // already saved module choices keep it off (modules/defaultFlips.ts).
  contributes: {
    "timeline.tool": [{ id: "browser.tool", order: 150, match: isBrowserTool, Row: BrowserToolRow }],
    "timeline.turnAttachment": [{ id: "browser.turnShots", order: 300, margin: { side: "right", minWidth: 200 }, Attachment: BrowserTurnAttachment }],
    // Its own page under 工具 (owner 2026-10-15: browser permissions did not belong on 对话).
    "settings.page": [{ id: "browser.settings", page: "browser", group: "tools", order: 50, icon: Globe, titleKey: "browser.title", source: null, Page: BrowserSettings,
      keywords: ["browser.settingsHint", "browser.hiddenTarget", "browser.hiddenTargetHint", "browser.viewportWidth", "browser.viewportHeight", "browser.viewportHint", "browser.idleDetach", "browser.idleDetachHint", "browser.host.approval", "browser.hold.limit", "browser.externalPages.label"] }],
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
      onClose: (instance) => closeBrowser(instance.binding.hostId, instance.state.tabKey),
      launcher: { order: 700, pin: "default", params: () => ({ url: "about:blank" }) },
    }],
  },
  activate: startBrowser,
});
