// 项目 (DESIGN §4.18): the projects page (overview, agents, tasks, memory, settings tabs) and its
// sidebar entry (step 3). Project groups in the sidebar stay core (they come with the snapshot).
// 轮换主管 (cutex `owner-rotation`): the dialog lives on the page; its default handoff wait is a
// section in Settings → 协作.
import { FolderKanban } from "lucide-react";
import { OWNER_ROTATION_FEATURE } from "../../../../shared/directorRotation";
import { defineModule } from "../slots";
import { ProjectsPage } from "./ProjectsPage";
import { RotationSettingsSection } from "./RotationSettings";
import { useProjectsTitle } from "./useProjectsTitle";

export default defineModule({
  id: "projects",
  titleKey: "projects.title",
  descriptionKey: "projects.description",
  contributes: {
    "nav.primary": [{ id: "projects.nav", order: 300, icon: FolderKanban, titleKey: "projects.nav", target: { page: "projects.page" } }],
    "main.page": [{ id: "projects.page", Page: ProjectsPage, useTitle: useProjectsTitle }],
    "settings.section": [
      {
        id: "projects.rotation.settings",
        page: "collab",
        order: 200,
        requires: { capabilities: [OWNER_ROTATION_FEATURE] },
        titleKey: "projects.rotation.settings",
        keywords: ["projects.rotation.settingsHandoff", "projects.rotation.settingsHandoffHint"],
        Section: RotationSettingsSection,
      },
    ],
  },
});
