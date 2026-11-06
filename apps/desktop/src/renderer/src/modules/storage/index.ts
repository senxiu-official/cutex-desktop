import { STORAGE_FEATURE } from "../../../../shared/storage";
import { HardDrive } from "lucide-react";
import { lazyPage } from "../../lib/lazyPage";
import { defineModule } from "../slots";
const StoragePage = lazyPage(() => import("./StoragePage").then((m) => m.StoragePage));
export default defineModule({
  id: "storage",
  titleKey: "storage.title",
  descriptionKey: "storage.description",
  contributes: {
    // Capability-gated navigation; the page itself also handles a legacy/deep-link fallback.
    "settings.page": [{ id: "storage.page", requires: { capabilities: [STORAGE_FEATURE] }, page: "storage", group: "data", order: 300, icon: HardDrive, titleKey: "storage.title", source: "host",  hintKey: "settings.pageHint.storage", keywords: ["storage.refresh", "storage.inventory"], Page: StoragePage }],
  },
});
