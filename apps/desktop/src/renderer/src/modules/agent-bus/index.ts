// Settings → 协作, policy first (settings audit 2026-10-15 #11): 消息投递 (cutex wake-busy-wait: how
// long a wake for a busy agent waits before its next step reads it) after 轮换主管 / 服务审批, and a
// collapsed 「高级」 card at the page end with 消息总线 (agent bus on / port / token) and 待清理 (停滞的委托,
// 卡住的消息 with cutex agent-bus-stuck-messages, 已隐藏的回执). Search finds them and opens the card.
import { defineModule } from "../slots";
import { ADVANCED_SECTION } from "./BusSettings";
import { lazyPage } from "../../lib/lazyPage";

// Loaded on first open (lib/lazyPage).
const DeliverySection = lazyPage(() => import("./BusSettings").then((m) => m.DeliverySection));
const AdvancedSection = lazyPage(() => import("./BusSettings").then((m) => m.AdvancedSection));

export default defineModule({
  id: "agent-bus",
  titleKey: "agent-bus.title",
  descriptionKey: "agent-bus.description",
  contributes: {
    "settings.section": [
      { id: "agent-bus.delivery", page: "collab", order: 350, titleKey: "agent-bus.delivery", keywords: ["agent-bus.wakeBusyWait"], Section: DeliverySection },
      {
        id: ADVANCED_SECTION,
        page: "collab",
        order: 900,
        titleKey: "agent-bus.advanced",
        keywords: ["agent-bus.page", "agent-bus.enabled", "agent-bus.port", "agent-bus.token", "agent-bus.cleanup.title", "agent-bus.cleanup.delegations", "agent-bus.cleanup.receipts", "agent-bus.stuck.title", "agent-bus.stuck.hint", "agent-bus.stuck.discardAll", "agent-bus.stuck.minAge"],
        Section: AdvancedSection,
      },
    ],
  },
});
