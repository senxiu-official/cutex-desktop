// 主人通知 (cutex owner-messages). Step 1: its section in Settings → 通知.
import { OWNER_NOTIFY_FEATURE } from "../../../../shared/ownerNotify";
import { OwnerNotifyBlock } from "../../components/settings/AppSettings";
import { defineModule } from "../slots";

export default defineModule({
  id: "owner-notify",
  titleKey: "owner-notify.title",
  descriptionKey: "owner-notify.description",
  requires: { capabilities: [OWNER_NOTIFY_FEATURE] },
  contributes: {
    "settings.section": [{ id: "owner-notify.settings", page: "notifications", order: 100, titleKey: "owner-notify.settings.ownerNotify.title", keywords: ["owner-notify.sound", "owner-notify.audience", "owner-notify.perHour", "owner-notify.urgentPerHour", "owner-notify.overrides"], Section: OwnerNotifyBlock }],
  },
});
