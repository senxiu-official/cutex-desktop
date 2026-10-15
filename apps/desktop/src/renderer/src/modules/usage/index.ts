// 用量：额度、Token 账本（曲线 / 堆叠）和价目表（DESIGN §4.9）。
import { BarChart3 } from "lucide-react";
import { defineModule } from "../slots";
import { UsagePage } from "./UsagePage";

export default defineModule({
  id: "usage",
  titleKey: "usage.title",
  descriptionKey: "usage.description",
  contributes: {
    "settings.page": [{ id: "usage.settings", page: "usage", group: "data", order: 100, icon: BarChart3, titleKey: "usage.page", source: "host", allHosts: { capability: "usage-ledger" }, Page: UsagePage, keywords: ["usage.quotas", "usage.ledger", "usage.prices", "usage.apiValue", "usage.cacheRate"] }],
  },
});
