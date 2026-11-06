// Core agent configuration: Profiles, 新建默认, 指令, 协作; step 3: 新建 agent (sidebar entry + page,
// greyed without human-create-agent; sidebar v5: a 「person +」 window-bar icon, right-click = 快速启动's menu).
import { Boxes, ScrollText, Sparkles, UserPlus, Users } from "lucide-react";
import { openQuickStartMenu } from "../../lib/quickStartMenu";
import { pageTitle } from "../react";
import { defineModule } from "../slots";
import { COLLAB_SEARCH, DEFAULTS_SEARCH, INSTRUCTIONS_SEARCH, PROFILES_SEARCH } from "./settingsSearch";
import { lazyPage } from "../../lib/lazyPage";

// Loaded on first open (lib/lazyPage).
const NewAgentPage = lazyPage(() => import("./NewAgentPage").then((m) => m.NewAgentPage));
const ProfilesPage = lazyPage(() => import("../../components/settings/ProfilesSettings").then((m) => m.ProfilesPage));
const DefaultsPage = lazyPage(() => import("../../components/settings/GlobalSettings").then((m) => m.DefaultsPage));
const InstructionsPage = lazyPage(() => import("../../components/settings/GlobalSettings").then((m) => m.InstructionsPage));
const CollabPage = lazyPage(() => import("../../components/settings/SecuritySettings").then((m) => m.CollabPage));

export default defineModule({
  id: "agent-config",
  titleKey: "agent-config.title",
  descriptionKey: "agent-config.description",
  required: true,
  contributes: {
    "nav.primary": [
      { id: "agent-config.newAgent", order: 200, icon: UserPlus, titleKey: "agent-config.newAgentNav", requires: { capabilities: ["human-create-agent"] }, target: { page: "agent-config.newAgent" }, menu: { open: openQuickStartMenu, hintKey: "agent-config.newAgentMenuHint" } },
    ],
    "main.page": [{ id: "agent-config.newAgent", Page: NewAgentPage, useTitle: pageTitle("agent-config.newAgent.title") }],
    "settings.page": [
      { id: "agent-config.profiles", page: "profiles", group: "agents", order: 100, icon: Boxes, titleKey: "agent-config.profiles", hintKey: "settings.pageHint.profiles", source: "host", Page: ProfilesPage, ...PROFILES_SEARCH },
      { id: "agent-config.defaults", page: "defaults", group: "agents", order: 200, icon: Sparkles, titleKey: "agent-config.defaults", source: "host", hintKey: "settings.pageHint.defaults", Page: DefaultsPage, ...DEFAULTS_SEARCH },
      { id: "agent-config.instructions", page: "instructions", group: "agents", order: 300, icon: ScrollText, titleKey: "agent-config.instructions", source: "host", hintKey: "settings.pageHint.instructions", Page: InstructionsPage, ...INSTRUCTIONS_SEARCH },
      { id: "agent-config.collab", page: "collab", group: "agents", order: 400, icon: Users, titleKey: "agent-config.collab", hintKey: "settings.pageHint.collab", source: "host", Page: CollabPage, ...COLLAB_SEARCH },
    ],
  },
});
