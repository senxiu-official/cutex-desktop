import { Archive } from "lucide-react";
import { defineModule } from "../slots";
import { lazyPage } from "../../lib/lazyPage";

// Loaded on first open (lib/lazyPage).
const ArchivePage = lazyPage(() => import("../../components/settings/AppSettings").then((m) => m.ArchivePage));
// 已归档的智能体 (owner 2026-11-24): filters, batch restore / delete and figures (./ArchivedManager).
const ArchivedSubPage = lazyPage(() => import("./ArchivedManager").then((m) => m.ArchivedManagerPage));
// 整理不常用的智能体 (owner 2026-11-26): active agents unused for N days, filtered, archived in one go (./IdleAgents).
const IdleSubPage = lazyPage(() => import("./IdleAgents").then((m) => m.IdleAgentsPage));

export default defineModule({
  id: "archive",
  // Locked on (module-dependencies-20261126, owner 2026-11-26): turning it off removed the way to handle work that goes on.
  required: true,
  titleKey: "archive.title",
  descriptionKey: "archive.description",
  contributes: {
    "settings.page": [{ id: "archive.settings", page: "archive", group: "data", order: 200, icon: Archive, titleKey: "archive.page", hintKey: "settings.pageHint.archive", source: "host", Page: ArchivePage, keywords: ["archive.deleteEmpty"], sections: [{ anchor: "idle", titleKey: "archive.idle.page" }, { anchor: "list", titleKey: "archive.list" }],
      subPages: { list: { titleKey: "archive.list", hintKey: "archive.archiveHint", Page: ArchivedSubPage, anchors: ["list-all"] },
        idle: { titleKey: "archive.idle.page", hintKey: "archive.idle.entry", Page: IdleSubPage, anchors: ["idle-all"] } } }],
  },
});
