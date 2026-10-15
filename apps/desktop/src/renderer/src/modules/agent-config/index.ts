// Core agent configuration: Profiles, 新建默认, 指令, 协作; step 3: 新建 agent (sidebar entry + page,
// greyed without human-create-agent).
import { Boxes, Plus, ScrollText, Sparkles, Users } from "lucide-react";
import { DefaultsPage, InstructionsPage } from "../../components/settings/GlobalSettings";
import { ProfilesPage } from "../../components/settings/ProfilesSettings";
import { CollabPage } from "../../components/settings/SecuritySettings";
import { pageTitle } from "../react";
import { defineModule } from "../slots";
import { NewAgentPage } from "./NewAgentPage";
import { COLLAB_SEARCH, DEFAULTS_SEARCH, INSTRUCTIONS_SEARCH, PROFILES_SEARCH } from "./settingsSearch";

export default defineModule({
  id: "agent-config",
  titleKey: "agent-config.title",
  descriptionKey: "agent-config.description",
  required: true,
  contributes: {
    "nav.primary": [
      { id: "agent-config.newAgent", order: 200, icon: Plus, titleKey: "agent-config.newAgentNav", requires: { capabilities: ["human-create-agent"] }, target: { page: "agent-config.newAgent" } },
    ],
    "main.page": [{ id: "agent-config.newAgent", Page: NewAgentPage, useTitle: pageTitle("agent-config.newAgent.title") }],
    "settings.page": [
      { id: "agent-config.profiles", page: "profiles", group: "agents", order: 100, icon: Boxes, titleKey: "agent-config.profiles", source: "host", Page: ProfilesPage, ...PROFILES_SEARCH },
      { id: "agent-config.defaults", page: "defaults", group: "agents", order: 200, icon: Sparkles, titleKey: "agent-config.defaults", source: "host", hintKey: "agent-config.defaults.pageHint", Page: DefaultsPage, ...DEFAULTS_SEARCH },
      { id: "agent-config.instructions", page: "instructions", group: "agents", order: 300, icon: ScrollText, titleKey: "agent-config.instructions", source: "host", hintKey: "agent-config.instructions.pageHint", Page: InstructionsPage, ...INSTRUCTIONS_SEARCH },
      { id: "agent-config.collab", page: "collab", group: "agents", order: 400, icon: Users, titleKey: "agent-config.collab", source: "host", Page: CollabPage, ...COLLAB_SEARCH },
    ],
  },
});
