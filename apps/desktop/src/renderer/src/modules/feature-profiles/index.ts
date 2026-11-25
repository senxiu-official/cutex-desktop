// 功能 Profile (cutex feature-profiles; owner 2026-11-25): Settings → 工具 → 功能 Profile, the host's model endpoints
// that only app features use (提示词增强 first). A page of its own, apart from 智能体 → Profile: these rows are never
// offered to agents (create, fork, switch, routing, auto-pick keep reading ordinary Profiles). Hidden on hosts without
// the capability (feature-profiles-desktop.md: rollback hides it).
import { KeyRound } from "lucide-react";
import { FEATURE_PROFILES_FEATURE } from "../../../../shared/featureProfiles";
import { defineModule } from "../slots";
import { lazyPage } from "../../lib/lazyPage";
import { ALL_SECTION, FEATURE_PROFILES_PAGE, LIST_SECTION } from "./FeatureProfilesPage";

const Page = lazyPage(() => import("./FeatureProfilesPage").then((m) => m.FeatureProfilesPage));
const AllPage = lazyPage(() => import("./FeatureProfilesPage").then((m) => m.FeatureProfilesAllPage));
const ListSection = lazyPage(() => import("./FeatureProfilesSection").then((m) => m.FeatureProfilesSection));
const AllSection = lazyPage(() => import("./FeatureProfilesSection").then((m) => m.FeatureProfilesAll));

export default defineModule({
  id: "feature-profiles",
  titleKey: "feature-profiles.title",
  descriptionKey: "feature-profiles.description",
  requires: { capabilities: [FEATURE_PROFILES_FEATURE] },
  contributes: {
    "settings.page": [{
      id: "feature-profiles.page", page: FEATURE_PROFILES_PAGE, group: "tools", order: 60, icon: KeyRound,
      titleKey: "feature-profiles.title", hintKey: "feature-profiles.pageHint", source: "host", Page,
      subPages: { all: { titleKey: "feature-profiles.section", Page: AllPage, anchors: [ALL_SECTION] } },
    }],
    "settings.section": [
      { id: LIST_SECTION, page: FEATURE_PROFILES_PAGE, order: 100, titleKey: "feature-profiles.section", keywords: ["feature-profiles.add", "feature-profiles.form.baseUrl", "feature-profiles.form.model"], Section: ListSection },
      { id: ALL_SECTION, page: FEATURE_PROFILES_PAGE, order: 101, titleKey: "feature-profiles.section", Section: AllSection },
    ],
  },
});
