import { Archive } from "lucide-react";
import { defineModule } from "../slots";
import { lazyPage } from "../../lib/lazyPage";

// Loaded on first open (lib/lazyPage).
const ArchivePage = lazyPage(() => import("../../components/settings/AppSettings").then((m) => m.ArchivePage));
// 已归档的智能体 (owner 2026-11-24): filters, batch restore / delete and figures (./ArchivedManager).
const ArchivedSubPage = lazyPage(() => import("./ArchivedManager").then((m) => m.ArchivedManagerPage));

export default defineModule({
  id: "archive",
  titleKey: "archive.title",
  descriptionKey: "archive.description",
  contributes: {
    "settings.page": [{ id: "archive.settings", page: "archive", group: "data", order: 200, icon: Archive, titleKey: "archive.page", hintKey: "settings.pageHint.archive", source: "host", Page: ArchivePage, keywords: ["archive.deleteEmpty"], sections: [{ anchor: "list", titleKey: "archive.list" }],
      subPages: { list: { titleKey: "archive.list", hintKey: "archive.archiveHint", Page: ArchivedSubPage, anchors: ["list-all"] } } }],
  },
});
