import { useI18n, type MessageKey } from "../../i18n";
import { AVATAR_TINTS, setUiPref, uiPrefDefault, useUiPrefs } from "../../lib/prefs";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useApp } from "../../store";
import { usePortraitThemes } from "../../lib/portraitThemes";
import { collectionStatus, hasPortraitCollections, usePortraitCollections } from "../../lib/portraitCollections";
import { getAppAvatarStyle, useAvatarStyleVersion } from "../../lib/avatarStyle";
import { AVATAR_SUB } from "../../lib/portraitSettingsNav";
import { DEFAULT_PORTRAIT_PACK } from "../../../../shared/portraitDefaults";
import { AvatarStyleLabel } from "./AvatarStylePicker";
import { ResetButton, Section, Segmented, SettingRow, SubPageRow, Toggle } from "./Form";

/** 完整头像主题 in a few words: 「已下载 2 / 20 · 1 个有更新」 (the bundled pack's themes); null where there is none. */
function useLibrarySummary(): string | null {
  const { t } = useI18n();
  const view = usePortraitCollections();
  const { themes } = usePortraitThemes();
  if (!hasPortraitCollections()) return null;
  if (!view) return t("common.loading");
  const states = themes.filter((th) => th.bundled && th.pack === DEFAULT_PORTRAIT_PACK).map((th) => collectionStatus(view, th.theme).kind);
  const installed = states.filter((k) => k === "installed" || k === "update").length;
  const updates = states.filter((k) => k === "update").length;
  const base = t("portraitLib.summary", { installed, total: states.length });
  return updates ? `${base} · ${t("portraitLib.summaryUpdates", { n: updates })}` : base;
}

/**
 * 外观's 「头像」 card: the row that opens the 头像 sub-page (lib/portraitSettingsNav) with what is set there now — the
 * style, the full themes downloaded, the Director's headwear — and, next to it, the short settings (owner 2026-11-28,
 * docs/design/settings-rules.md §8): 默认头像, 头像底色 and the two headwear switches stay on 外观; only the galleries
 * and lists (头像风格, 完整头像主题, bulk changes, the headwear styles) are on the sub-page. Stored keys are unchanged.
 */
export function AvatarEntrySection() {
  const { t } = useI18n();
  const ui = useUiPrefs();
  useAvatarStyleVersion();
  const library = useLibrarySummary();
  const openSettings = useApp((s) => s.openSettings);
  const headwear = t("avatarPage.headwear", { name: t(`appearance.headwear.${ui.directorHeadwear}` as MessageKey) });
  return (
    <Section id={settingsAnchorId("avatar")} title={t("avatarPage.title")} hint={t("avatarPage.cardHint")}>
      <SubPageRow
        title={t("avatarPage.row")}
        summary={<span data-avatar-summary=""><AvatarStyleLabel style={getAppAvatarStyle()} />{library ? ` · ${library}` : ""} · {headwear}</span>}
        onOpen={() => openSettings("appearance", { sub: AVATAR_SUB })}
      />
      <SettingRow agents="none" source="local" label={t("avatarStyle.important" as MessageKey)} hint={t("avatarStyle.importantHint" as MessageKey)}>
        <Toggle checked={ui.agentAvatarDefault === "important"} onChange={(v) => setUiPref("agentAvatarDefault", v ? "important" : "emoji")} />
      </SettingRow>
      <SettingRow agents="none" source="local" label={t("appearance.avatarTint")} hint={t("appearance.avatarTintHint")} reset={<ResetButton disabled={ui.avatarTint === uiPrefDefault("avatarTint")} onClick={() => setUiPref("avatarTint", uiPrefDefault("avatarTint"))} />}>
        <Segmented value={ui.avatarTint} options={AVATAR_TINTS.map((v) => ({ value: v, label: t(`appearance.avatarTint.${v}` as MessageKey) }))} onChange={(v) => setUiPref("avatarTint", v)} />
      </SettingRow>
      <SettingRow agents="none" source="local" label={t("appearance.headwear.operators")} hint={t("appearance.headwear.operatorsHint")} reset={<ResetButton disabled={ui.operatorHeadwear} onClick={() => setUiPref("operatorHeadwear", true)} />}>
        <Toggle checked={ui.operatorHeadwear} onChange={(v) => setUiPref("operatorHeadwear", v)} disabled={ui.directorHeadwear === "none"} />
      </SettingRow>
      <SettingRow agents="none" source="local" label={t("appearance.headwear.seasonal")} hint={t("appearance.headwear.seasonalHint")} reset={<ResetButton disabled={ui.seasonalHeadwear} onClick={() => setUiPref("seasonalHeadwear", true)} />}>
        <Toggle checked={ui.seasonalHeadwear} onChange={(v) => setUiPref("seasonalHeadwear", v)} disabled={ui.directorHeadwear === "none"} />
      </SettingRow>
    </Section>
  );
}
