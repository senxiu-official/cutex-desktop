// 项目 (DESIGN §4.18): the projects page (overview, agents, tasks, memory, settings tabs) and its
// sidebar entry (step 3). Project groups in the sidebar stay core (they come with the snapshot).
// 轮换主管 (cutex `owner-rotation`): the dialog lives on the page; its default handoff wait is a
// section in Settings → 协作.
import { FolderKanban } from "lucide-react";
import { OWNER_ROTATION_FEATURE } from "../../../../shared/directorRotation";
import { defineModule } from "../slots";
import { useProjectsTitle } from "./useProjectsTitle";
import { lazyPage } from "../../lib/lazyPage";
import { MemoryEditRow } from "./MemoryEditRow";
import { memoryEditsOf, memoryGatherKey } from "./memoryEdits";

// Loaded on first open (lib/lazyPage).
const RotationSettingsSection = lazyPage(() => import("./RotationSettings").then((m) => m.RotationSettingsSection));

const ProjectsPage = lazyPage(() => import("./ProjectsPage").then((m) => m.ProjectsPage));

export default defineModule({
  id: "projects",
  // Locked on (module-dependencies-20261126, owner 2026-11-26): turning it off removed the way to handle work that goes on.
  required: true,
  titleKey: "projects.title",
  descriptionKey: "projects.description",
  contributes: {
    "nav.primary": [{ id: "projects.nav", order: 300, icon: FolderKanban, titleKey: "projects.nav", target: { page: "projects.page" } }],
    "main.page": [{ id: "projects.page", Page: ProjectsPage, useTitle: useProjectsTitle }],
    // 「更新项目记忆 · …」 (owner 2026-11-28): an agent's file edits inside a project memory directory, every one of a turn
    // in one row outside the work group. After safety-grants (400: a refused edit keeps its 已拦截 row), before the
    // standard file change row (460).
    "timeline.tool": [{ id: "projects.memoryEdit", order: 420, match: (item) => memoryEditsOf(item) !== null, Row: MemoryEditRow, standalone: () => true, gather: memoryGatherKey }],
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
