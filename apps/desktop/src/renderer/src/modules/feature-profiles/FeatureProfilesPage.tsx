// Settings → 功能 Profile: the page and its 全部 sub-page (sections in ./FeatureProfilesSection.tsx).
import { SettingsSections } from "../Outlet";
import { useScrollToSettingsAnchor } from "../../lib/settingsFocus";

export const FEATURE_PROFILES_PAGE = "feature-profiles";
export const LIST_SECTION = "feature-profiles.list";
export const ALL_SECTION = "feature-profiles.all";

export function FeatureProfilesPage() {
  useScrollToSettingsAnchor();
  return <SettingsSections page="feature-profiles" only={[LIST_SECTION]} />;
}

export function FeatureProfilesAllPage() {
  useScrollToSettingsAnchor();
  return <SettingsSections page="feature-profiles" only={[ALL_SECTION]} />;
}
