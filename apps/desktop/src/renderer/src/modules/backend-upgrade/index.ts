// 后端更新 (cutex `backend-upgrade`, owner only; cutex docs/backend-upgrade.md, desktop RFC
// docs/research/backend-auto-update-rfc-20261014.md §7.2): Settings → 系统 → 后端更新, a host page
// right before 更新与诊断 (owner 2026-10-15: the cutex upgrade is host-wide, not an agent setting, and
// sits next to the desktop's own updates; it is the only place that shows the cutex build and the
// runtimes new agents get, so 运行时 keeps a header link here): each host runs its own cutex, so the page follows the settings host picker. cutex does every step (check, signed download + preflight, wait for idle
// agents, backup, swap, verify, automatic rollback); the page shows its state and triggers it. The nav
// dot says an update is downloaded / available, a run is going, or one needs the owner. Hidden on a
// cutex without the capability (and for non-owner connections: shared/users OWNER_ONLY_CAPABILITIES).
import { ServerCog } from "lucide-react";
import { BACKEND_UPGRADE_FEATURE } from "../../../../shared/backendUpgrade";
import { useSettingsHost } from "../../lib/settingsHost";
import { defineModule } from "../slots";
import { BackendUpgradePage } from "./BackendUpgradePage";
import { upgradeAttention } from "./model";
import { startUpgradeSync, useHostUpgrade } from "./store";

function useUpgradeBadge() {
  const hostId = useSettingsHost();
  const u = useHostUpgrade(hostId);
  return upgradeAttention(u.status, u.event) === "none" ? null : { dot: true };
}

export default defineModule({
  id: "backend-upgrade",
  titleKey: "backend-upgrade.title",
  descriptionKey: "backend-upgrade.description",
  activate: (ctx) => startUpgradeSync(ctx),
  contributes: {
    "settings.page": [
      {
        id: "backend-upgrade.page",
        page: "backend",
        group: "system",
        order: 225,
        icon: ServerCog,
        titleKey: "backend-upgrade.page",
        source: "host",
        // Which cutex this is (the picked host's), next to the desktop's own 更新与诊断 (review UI-04).
        hintKey: "backend-upgrade.pageHint",
        headerLink: { page: "updates", labelKey: "backend-upgrade.desktopLink" },
        requires: { capabilities: [BACKEND_UPGRADE_FEATURE] },
        useBadge: useUpgradeBadge,
        Page: BackendUpgradePage,
        keywords: ["backend-upgrade.check", "backend-upgrade.status.installed"],
        sections: [
          { anchor: "status", titleKey: "backend-upgrade.status.title", keywords: ["backend-upgrade.status.installed", "backend-upgrade.status.build", "backend-upgrade.status.runtimes", "backend-upgrade.status.serviceManager", "backend-upgrade.status.install"] },
          { anchor: "update", titleKey: "backend-upgrade.update.title", keywords: ["backend-upgrade.stage.label", "backend-upgrade.apply.button"] },
          { anchor: "rollback", titleKey: "backend-upgrade.rollback.title", keywords: ["backend-upgrade.rollback.preview"] },
          { anchor: "history", titleKey: "backend-upgrade.history.title" },
          { anchor: "settings", titleKey: "backend-upgrade.settings.title", keywords: ["backend-upgrade.settings.channel", "backend-upgrade.settings.interval", "backend-upgrade.settings.autoStage", "backend-upgrade.settings.autoApply", "backend-upgrade.packageRun.label"] },
        ],
      },
    ],
  },
});
