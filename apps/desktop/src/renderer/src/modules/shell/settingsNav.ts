// The shell's 设置 entry and page (step 3): sidebar footer entry + `shell.settings` breadcrumb hooks.
import { useI18n } from "../../i18n";
import { useAboutAttention, useOutdatedAgentCount } from "../../lib/runtimePackagesView";
import { useSettingsAttention } from "../../lib/settingsAttention";
import { useOwnerDevicesAttention } from "../../components/settings/OwnerDevices";
import { settingsTab } from "../../lib/settingsNav";
import { profilePageOf, SETTINGS_PAGE, useApp } from "../../store";
import { services } from "../app";
import { useSlot } from "../react";
import type { PageCrumb, PageParams } from "../slots";

export { openSettingsFromNav } from "../../lib/openSettings";

/** Red dot: agents on an old runtime, a desktop update, or a module's reason (a host's backend update). */
export function useSettingsBadge() {
  const { t } = useI18n();
  const dot = useAboutAttention();
  const outdated = useOutdatedAgentCount();
  const extra = useSettingsAttention();
  // A new owner device (full control) on the focus host: 连接 → 用户 announces it.
  const ownerDevice = useOwnerDevicesAttention();
  if (!dot && extra.length === 0 && !ownerDevice) return null;
  const lines = dot ? [outdated > 0 ? t("runtimePackages.dotHint", { n: outdated }) : t("settings.about.attention")] : [];
  for (const key of extra) lines.push(t(key as Parameters<typeof t>[0]));
  if (ownerDevice) lines.push(t("ownerDev.navAttention"));
  return { dot: true, title: lines.join("\n") };
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
