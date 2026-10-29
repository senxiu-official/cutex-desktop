import { Archive } from "lucide-react";
import { defineModule } from "../slots";
import { lazyPage } from "../../lib/lazyPage";

// Loaded on first open (lib/lazyPage).
const ArchivePage = lazyPage(() => import("../../components/settings/AppSettings").then((m) => m.ArchivePage));

export default defineModule({
  id: "archive",
  titleKey: "archive.title",
  descriptionKey: "archive.description",
  contributes: {
    "settings.page": [{ id: "archive.settings", page: "archive", group: "data", order: 200, icon: Archive, titleKey: "archive.page", source: "host", Page: ArchivePage, keywords: ["archive.deleteEmpty"], sections: [{ anchor: "list", titleKey: "archive.list" }] }],
  },
});
