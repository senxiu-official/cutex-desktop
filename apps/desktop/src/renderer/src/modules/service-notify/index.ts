// 服务通知 (cutex `service-notifications-v1`; .claude/reports/whatsapp-notify-desktop-ui-20261125.md): what
// registered services post through the general service-notification channel. Separate from agent
// notifications, owner_notify and NextUp (a service never posts as an agent; nothing here becomes a NextUp item).
// - Settings → 应用 → 通知: a 服务通知 card in the host part, one row per service (R6).
// - Settings → 通知 → 服务通知 (detail page, navParent 通知): one service's switches, desktop / phone, keep
//   content, quiet hours (host local time), its latest history; sub-page 全部记录 (all services, by source).
// - Any service's notices show here, WhatsApp's too when the host has them; WhatsApp's own UI (status, 打开) is the
//   separate `whatsapp` module (default off), which also registers how its notification opens (lib/serviceOpeners).
// - A clicked desktop notification (main raises and resolves it; `serviceNotificationOpen`) opens the service.
// main holds every credential; the renderer reads settings / history through main and never logs message text.
import { BellRing } from "lucide-react";
import { SERVICE_NOTIFICATIONS_FEATURE } from "../../../../shared/serviceNotifications";
import { bridge } from "../../bridge";
import { lazyPage } from "../../lib/lazyPage";
import { defineModule } from "../slots";
import { SERVICE_NOTIFY_PAGE } from "./nav";
import { openServiceNotification } from "./open";

// Loaded on first open (lib/lazyPage).
const ServiceNotifySection = lazyPage(() => import("./ServiceNotifySection").then((m) => m.ServiceNotifySection));
const ServiceNotifyPage = lazyPage(() => import("./ServiceNotifyPage").then((m) => m.ServiceNotifyPage));
const ServiceNotifyHistoryPage = lazyPage(() => import("./ServiceNotifyPage").then((m) => m.ServiceNotifyHistoryPage));

const HOST = { capabilities: [SERVICE_NOTIFICATIONS_FEATURE] } as const;

export default defineModule({
  id: "service-notify",
  titleKey: "service-notify.title",
  descriptionKey: "service-notify.description",
  contributes: {
    "settings.section": [
      {
        id: "service-notify.settings",
        page: "notifications",
        order: 400,
        requires: HOST,
        titleKey: "service-notify.section.title",
        keywords: ["service-notify.section.history", "service-notify.quiet.title"],
        Section: ServiceNotifySection,
      },
    ],
    "settings.page": [
      {
        id: "service-notify.page",
        page: SERVICE_NOTIFY_PAGE,
        group: "app",
        order: 610,
        navParent: "notifications",
        icon: BellRing,
        titleKey: "service-notify.page",
        hintKey: "service-notify.pageHint",
        source: null,
        hostPart: true,
        Page: ServiceNotifyPage,
        sections: [
          { anchor: "alerts", titleKey: "service-notify.settings.title", keywords: ["service-notify.settings.desktop", "service-notify.settings.phone", "service-notify.settings.retain", "service-notify.quiet.title"], requires: HOST, part: "host" },
          { anchor: "history", titleKey: "service-notify.history.title", requires: HOST, part: "host" },
        ],
        subPages: { history: { titleKey: "service-notify.history.all", hintKey: "service-notify.history.hint", Page: ServiceNotifyHistoryPage, anchors: ["history-all"] } },
      },
    ],
  },
  activate: (ctx) => {
    // (no bridge events in unit tests)
    if (typeof bridge.on !== "function") return;
    const off = bridge.on("serviceNotificationOpen", (target) => void openServiceNotification(target, ctx.services.side).catch(() => {}));
    ctx.signal.addEventListener("abort", off);
  },
});
