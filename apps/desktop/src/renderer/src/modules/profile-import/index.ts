// 从 CC Switch 导入 (cutex profile-import-cc-switch, owner only): a section of Settings → 智能体 →
// Profile that lists the Claude Code / Codex providers CC Switch has set up on the target host and
// turns the picked ones into profiles (cutex copies the keys; CC Switch is only read). The list and
// the import are the shell component components/ProfileImport.tsx, which the onboarding embeds too.
// Hidden without the capability.
import { CC_SWITCH_IMPORT_FEATURE } from "../../../../shared/ccSwitchImport";
import { defineModule } from "../slots";
import { ProfileImportSection } from "./ProfileImportSection";

export default defineModule({
  id: "profile-import",
  titleKey: "profile-import.title",
  descriptionKey: "profile-import.description",
  requires: { capabilities: [CC_SWITCH_IMPORT_FEATURE] },
  contributes: {
    "settings.section": [
      {
        id: "profile-import.ccSwitch",
        page: "profiles",
        order: 200,
        titleKey: "profile-import.section",
        keywords: ["profile-import.sectionHint", "profile-import.app.claude", "profile-import.app.codex"],
        Section: ProfileImportSection,
      },
    ],
  },
});
