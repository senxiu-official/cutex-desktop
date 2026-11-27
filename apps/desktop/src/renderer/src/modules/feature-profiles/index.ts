// 功能 Profile (cutex feature-profiles; owner 2026-11-25): the host's model endpoints that only app features use
// (提示词增强 first). A card of Settings → 智能体 → Profile (owner 2026-11-26: 「功能Profile的设置页面和Profile不在一起」),
// after the agent Profiles' own cards, like Claude 账户 / Kimi 账户; its 全部 N 个 is the Profile page's sub-page
// `features` (lib/featureProfilesNav). A card of its own with its own API: these rows are never offered to agents
// (create, fork, switch, routing, auto-pick keep reading ordinary Profiles). Hidden on hosts without the capability
// (feature-profiles-desktop.md: rollback hides it). The old page id `feature-profiles` lands here (lib/settingsNav).
import { FEATURE_PROFILES_FEATURE } from "../../../../shared/featureProfiles";
import { FEATURE_PROFILES_ALL_SECTION, FEATURE_PROFILES_SECTION } from "../../lib/featureProfilesNav";
import { defineModule } from "../slots";
import { lazyPage } from "../../lib/lazyPage";

const ListSection = lazyPage(() => import("./FeatureProfilesSection").then((m) => m.FeatureProfilesSection));
const AllSection = lazyPage(() => import("./FeatureProfilesSection").then((m) => m.FeatureProfilesAll));

export default defineModule({
  id: "feature-profiles",
  titleKey: "feature-profiles.title",
  descriptionKey: "feature-profiles.description",
  requires: { capabilities: [FEATURE_PROFILES_FEATURE] },
  contributes: {
    "settings.section": [
      // After Claude 账户 (100), Kimi 账户 (110) and 从 CC Switch 导入 (200): the agent Profiles' cards stay together.
      { id: FEATURE_PROFILES_SECTION, page: "profiles", order: 300, titleKey: "feature-profiles.section", keywords: ["feature-profiles.add", "feature-profiles.form.baseUrl", "feature-profiles.form.model"], Section: ListSection },
      { id: FEATURE_PROFILES_ALL_SECTION, page: "profiles", order: 301, titleKey: "feature-profiles.section", Section: AllSection },
    ],
  },
});
