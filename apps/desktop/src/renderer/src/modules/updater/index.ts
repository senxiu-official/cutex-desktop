// Desktop updates: Settings → 更新与诊断, its own page in 系统 right above 关于 (owner 2026-10-10; was
// a section of 通用). The nav dot shows when an update is ready.
import { RefreshCw } from "lucide-react";
import { UpdatesPage } from "../../components/settings/AppSettings";
import { updateButtonVisible, useUpdateStatus } from "../../lib/update";
import { defineModule } from "../slots";

function useUpdateBadge() {
  return updateButtonVisible(useUpdateStatus()) ? { dot: true } : null;
}

export default defineModule({
  id: "updater",
  titleKey: "updater.title",
  descriptionKey: "updater.description",
  contributes: {
    "settings.page": [
      {
        id: "updater.page",
        page: "updates",
        group: "system",
        order: 250,
        icon: RefreshCw,
        titleKey: "updater.general.updates",
        source: "local",
        // This desktop's updates, not a host's cutex (that is 主机后端更新; review UI-04).
        hintKey: "updater.pageHint",
        headerLink: { page: "backend", labelKey: "updater.backendLink" },
        useBadge: useUpdateBadge,
        Page: UpdatesPage,
        sections: [
          { anchor: "updates", titleKey: "updater.section.updates", keywords: ["updater.updateCheck", "updater.updateCheck.now", "updater.updateCheck.current", "updater.channel", "updater.channel.main", "updater.channel.release", "updater.source"] },
          { anchor: "diagnostics", titleKey: "updater.section.diagnostics", keywords: ["updater.errorLog", "updater.errorLog.open"] },
        ],
      },
    ],
  },
});
