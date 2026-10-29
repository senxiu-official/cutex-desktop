// Settings → 关于 → 更新摘要: the per-version summary switch and this version's summary. Replaying the introduction,
// the 0.2 part and the tips lives in one place, Settings → 帮助 (Director 2026-10-24): here only a link to it.
import { Button, Section, SettingRow, Toggle } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { bundledReleases, openOnboarding, setTestEveryBuild, setWhatsNewEnabled, useOnboarding } from "../../lib/onboarding";
import { useUpdateStatus } from "../../lib/update";
import { useApp } from "../../store";

export function OnboardingSection() {
  const { t } = useI18n();
  const state = useOnboarding();
  const status = useUpdateStatus();
  const installed = status?.current?.version ?? null;
  // Testing switch: development builds only (a source install on a channel other than release).
  const devBuild = !!status?.channel && status.channel !== "release";
  // A build without a version (dev) shows the newest listed release.
  const releases = bundledReleases();
  const version = installed && releases.some((r) => r.version === installed) ? installed : (releases[0]?.version ?? null);
  return (
    <Section title={t("onboarding.section")} hint={t("onboarding.sectionHint")}>
      <SettingRow agents="none" source="local" label={t("onboarding.whatsNewToggle")} hint={t("onboarding.whatsNewToggleHint")}>
        <Toggle checked={state.whatsNew} onChange={setWhatsNewEnabled} label={t("onboarding.whatsNewToggle")} />
      </SettingRow>
      <SettingRow navigation agents="none" source="local" label={t("onboarding.helpLink")}>
        <Button onClick={() => useApp.getState().openSettings("help")}>{t("onboarding.helpLink.open")}</Button>
      </SettingRow>
      {(devBuild || state.testEveryBuild) && (
        <SettingRow agents="none" source="local" label={t("onboarding.testEveryBuild")} hint={t("onboarding.testEveryBuildHint")}>
          <Toggle checked={state.testEveryBuild} onChange={setTestEveryBuild} label={t("onboarding.testEveryBuild")} />
        </SettingRow>
      )}
      {version && (
        <SettingRow navigation label={t("onboarding.replayWhatsNew")} agents="none" source="local">
          <Button onClick={() => openOnboarding({ kind: "whatsNew", version })}>{version}</Button>
        </SettingRow>
      )}
    </Section>
  );
}
