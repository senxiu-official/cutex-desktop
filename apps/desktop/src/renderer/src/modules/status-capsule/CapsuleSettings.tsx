// The status capsule module's own settings page (owner 2026-11-28: 模块 → 状态胶囊 → 设置; was a card of the retired
// 状态显示 page): which items show in the capsule, then its geometry (corner, edge, always show, size). It exists only
// while the module is on. Values are ui / appearance prefs and the items' saved places; they survive turning it off.
import { useI18n, type MessageKey } from "../../i18n";
import { CAPSULE_CORNERS } from "../../lib/capsuleLayout";
import { setUiPref, useUiPrefs } from "../../lib/prefs";
import { AppearanceNumberRow } from "../../components/settings/AppearanceRows";
import { Section, Segmented, SettingRow, Toggle } from "../../components/settings/Form";
import { StatusItemChecks } from "../../components/settings/StatusItemChecks";
import { settingsAnchorId } from "../../lib/settingsNav";
import { capsuleToggle, inCapsule } from "../../lib/statusItems";

/** 模块 → 状态胶囊 → 设置. */
export function CapsuleSettingsPage() {
  const { t } = useI18n();
  return (
    <>
      <Section id={settingsAnchorId("status-capsule-items")} title={t("status-capsule.contents")}>
        <StatusItemChecks kind="capsule" surface="capsule" title={t("status-capsule.itemsLabel")} hint={t("status-capsule.itemsHint")} checked={(p) => inCapsule(p.place)} next={(p) => capsuleToggle(p.place)} />
      </Section>
      <CapsuleSettingsSection />
    </>
  );
}

export function CapsuleSettingsSection() {
  const { t } = useI18n();
  const ui = useUiPrefs();
  return (
    <Section id={settingsAnchorId("status-capsule-look")} title={t("status-capsule.look")}>
      <SettingRow agents="none" source="local" label={t("status-capsule.corner")} hint={t("status-capsule.corner.hint")}>
        <Segmented
          value={ui.capsuleCorner}
          options={CAPSULE_CORNERS.map((c) => ({ value: c, label: t(`status-capsule.corner.${c}` as MessageKey) }))}
          onChange={(v) => setUiPref("capsuleCorner", v)}
        />
      </SettingRow>
      <SettingRow agents="none" source="local" label={t("status-capsule.edge")} info={t("status-capsule.edge.hint")}>
        <Segmented
          value={ui.capsuleEdge}
          options={[
            { value: "window" as const, label: t("status-capsule.edge.window") },
            { value: "content" as const, label: t("status-capsule.edge.content") },
          ]}
          onChange={(v) => setUiPref("capsuleEdge", v)}
        />
      </SettingRow>
      <SettingRow agents="none" source="local" label={t("status-capsule.always")} info={t("status-capsule.always.hint")}>
        <Toggle checked={ui.capsuleAlways} onChange={(v) => setUiPref("capsuleAlways", v)} />
      </SettingRow>
      <AppearanceNumberRow field="capsuleScale" label="status-capsule.scale" hint="status-capsule.scaleHint" unit="%" step={5} />
    </Section>
  );
}
