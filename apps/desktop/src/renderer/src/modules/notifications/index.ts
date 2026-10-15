// Core notifications (docs/research/notification-levels.md; contract 1.3 `notify.method`, §17): the
// host's two tables live in cutex (event → level, level → method); this module executes them on this
// device. It owns Settings → 应用 → 通知 and contributes the device methods desktop notification /
// sound / big alert. Locked: the shell and the owner-notify store report through lib/notifyEvents.
import { Bell } from "lucide-react";
import { NOTIFICATION_LEVELS_FEATURE } from "../../../../shared/notificationLevels";
import { defineModule } from "../slots";
import { bigAlertMethod, desktopMethod, soundMethod } from "./methods";
import { NotificationsPage } from "./NotificationsPage";
import { startNotifications } from "./runtime";

const HOST = { capabilities: [NOTIFICATION_LEVELS_FEATURE] } as const;

export default defineModule({
  id: "notifications",
  titleKey: "notifications.title",
  descriptionKey: "notifications.description",
  required: true,
  contributes: {
    "settings.page": [
      {
        id: "notifications.settings",
        page: "notifications",
        group: "app",
        order: 600,
        icon: Bell,
        titleKey: "notifications.page",
        source: null,
        Page: NotificationsPage,
        // The host part (SettingsHostPart) holds every card but 本设备's and the settings.section items.
        hostPart: true,
        sections: [
          { anchor: "levels", titleKey: "notifications.matrix.title", keywords: ["notifications.preset", "notifications.method.desktop", "notifications.method.sound", "notifications.method.bigAlert", "notifications.method.phone", "notifications.level.urgent", "notifications.level.inform"], requires: HOST, part: "host" },
          { anchor: "events", titleKey: "notifications.events.title", keywords: ["notifications.events.changedOnly", "notifications.eventPreset.default"], requires: HOST, part: "host" },
          { anchor: "device", titleKey: "notifications.device.title", keywords: ["notifications.device.permission", "notifications.method.desktop", "notifications.method.sound", "notifications.method.bigAlert", "notifications.device.test.desktop"] },
          { anchor: "newAgentLevel", titleKey: "agent-config.defaults.notification", keywords: ["notify.newAgentLevel", "notify.lvl.important"], part: "host" },
          { anchor: "mute", titleKey: "notifications.mute.title", requires: HOST, part: "host" },
        ],
      },
    ],
    "notify.method": [desktopMethod, soundMethod, bigAlertMethod],
  },
  activate: (ctx) => startNotifications(ctx),
});
