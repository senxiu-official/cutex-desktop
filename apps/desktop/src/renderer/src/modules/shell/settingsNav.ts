// The shell's 设置 entry and page (step 3): sidebar footer entry + `shell.settings` breadcrumb hooks.
import { useI18n } from "../../i18n";
import { useAboutAttention, useOutdatedAgentCount } from "../../lib/runtimePackagesView";
import { useSettingsAttention } from "../../lib/settingsAttention";
import { useOwnerDevicesAttention } from "../../components/settings/OwnerDevices";
import { useSettingsHost } from "../../lib/settingsHost";
import { settingsTab } from "../../lib/settingsNav";
import { useHostScope } from "../../lib/useHostScope";
import { profilePageOf, SETTINGS_PAGE, useApp } from "../../store";
import { useSettingsShelf } from "../../lib/settingsShelf";
import { services } from "../app";
import { useSlot } from "../react";
import type { PageCrumb, PageParams } from "../slots";

export { openSettingsFromNav, toggleSettingsFromNav } from "../../lib/openSettings";

/** The footer ⚙ is highlighted while the Settings Shelf is open (lib/settingsShelf). */
export function useSettingsShelfOpen(): boolean {
  return useSettingsShelf((s) => s.open);
}

/** Red dot: agents on an old runtime, a desktop update, or a module's reason (a host's backend update). */
export function useSettingsBadge() {
  const { t } = useI18n();
  const dot = useAboutAttention();
  const outdated = useOutdatedAgentCount();
  const extra = useSettingsAttention();
  // A new owner device (full control) on a connected host: 连接 → 用户 announces it.
  const ownerDevice = useOwnerDevicesAttention();
  if (!dot && extra.length === 0 && !ownerDevice) return null;
  const lines = dot ? [outdated > 0 ? t("runtimePackages.dotHint", { n: outdated }) : t("settings.about.attention")] : [];
  for (const key of extra) lines.push(t(key as Parameters<typeof t>[0]));
  if (ownerDevice) lines.push(t("ownerDev.navAttention"));
  return { dot: true, title: lines.join("\n") };
}

/** 设置 › [<parent> ›] <page> (› <profile> / 添加 on Profiles, › a sub-page; a crumb goes back to its page). */
export function useSettingsTitle(params: PageParams): readonly PageCrumb[] {
  const { t } = useI18n();
  const pages = useSlot("settings.page");
  const scope = useHostScope();
  const hostId = useSettingsHost();
  const tab = settingsTab(params);
  const sub = profilePageOf(params);
  const item = pages.find((e) => e.item.page === tab)?.item;
  const subKey = params.sub ? item?.subPages?.[params.sub]?.titleKey : undefined;
  const leaf = sub?.kind === "new" ? t("settings.profiles.new.title") : (sub?.name ?? (subKey ? t(subKey) : undefined));
  const parent = item?.navParent ? pages.find((e) => e.item.page === item.navParent)?.item : undefined;
  const pageText = item?.hostTitle ? (scope.host(hostId)?.label ?? hostId) : item ? t(item.titleKey) : tab;
  const crumbs: PageCrumb[] = [{ text: t("settings.title") }];
  if (parent) crumbs.push({ text: t(parent.titleKey), to: { page: SETTINGS_PAGE, params: { tab: parent.page } } });
  crumbs.push({ text: pageText, to: leaf ? { page: SETTINGS_PAGE, params: { tab } } : undefined });
  if (leaf) crumbs.push({ text: leaf });
  return crumbs;
}
