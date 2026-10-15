// The shell's 设置 entry and page (step 3): sidebar footer entry + `shell.settings` breadcrumb hooks.
import { useI18n } from "../../i18n";
import { useAboutAttention, useOutdatedAgentCount } from "../../lib/runtimePackagesView";
import { settingsTab } from "../../lib/settingsNav";
import { profilePageOf, SETTINGS_PAGE, useApp } from "../../store";
import { services } from "../app";
import { useSlot } from "../react";
import type { PageCrumb, PageParams } from "../slots";

export { openSettingsFromNav } from "../../lib/openSettings";

/** Red dot: agents on an old runtime or a desktop update. */
export function useSettingsBadge() {
  const { t } = useI18n();
  const dot = useAboutAttention();
  const outdated = useOutdatedAgentCount();
  if (!dot) return null;
  return { dot: true, title: outdated > 0 ? t("runtimePackages.dotHint", { n: outdated }) : t("settings.about.attention") };
}

/** 设置 › <page> (› <profile> / 添加 on Settings → Profiles; the page crumb goes back to the overview). */
export function useSettingsTitle(params: PageParams): readonly PageCrumb[] {
  const { t } = useI18n();
  const pages = useSlot("settings.page");
  const tab = settingsTab(params);
  const sub = profilePageOf(params);
  const leaf = sub?.kind === "new" ? t("settings.profiles.new.title") : sub?.name;
  const pageKey = pages.find((e) => e.item.page === tab)?.item.titleKey;
  const crumbs: PageCrumb[] = [{ text: t("settings.title") }, { text: pageKey ? t(pageKey) : tab, to: leaf ? { page: SETTINGS_PAGE, params: { tab } } : undefined }];
  if (leaf) crumbs.push({ text: leaf });
  return crumbs;
}
