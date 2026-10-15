import { Archive } from "lucide-react";
import { ArchivePage } from "../../components/settings/AppSettings";
import { defineModule } from "../slots";

export default defineModule({
  id: "archive",
  titleKey: "archive.title",
  descriptionKey: "archive.description",
  contributes: {
    "settings.page": [{ id: "archive.settings", page: "archive", group: "data", order: 200, icon: Archive, titleKey: "archive.page", source: "host", Page: ArchivePage, keywords: ["archive.deleteEmpty"], sections: [{ anchor: "list", titleKey: "archive.list" }] }],
  },
});
