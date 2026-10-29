import { Download } from "lucide-react";
import { defineModule } from "../slots";
import { lazyPage } from "../../lib/lazyPage";
import { useI18n } from "../../i18n";
import { COPIES } from "../../lib/remoteCopies";
const CopyPage = lazyPage(() => import("./CopyPage").then(m => m.CopyPage));
const CopySettings = lazyPage(() => import("./Settings").then(m => m.CopySettings));
function useTab() { const { t } = useI18n(); return { title: t("remote-copies.title") }; }
export default defineModule({
  id: "remote-copies", titleKey: "remote-copies.title", descriptionKey: "remote-copies.description",
  contributes: {
    // Local copies stay available even if their source has no current connection.
    "side.component": [
      { id: COPIES, titleKey: "remote-copies.title", icon: Download, instances: "singleton", defaultBinding: "host", placement: { home: "reference", order: 450 }, parseParams: () => ({}), init: () => ({}), restore: () => ({}), useTab, Body: CopyPage, launcher: { category: "content", order: 450, params: () => ({}) } },
    ],
    "settings.section": [{ id: "remote-copies.settings", page: "sides", order: 470, titleKey: "remote-copies.settings", keywords: ["remote-copies.retention", "remote-copies.retentionHint"], Section: CopySettings }],
  },
});
