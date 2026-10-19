// Settings → 关于 → 引导与新功能: the per-version 新功能 switch and replays of the introduction / this version's
// 新功能 (lib/onboarding; the dialog is components/OnboardingDialog).
import { Button, Section, SettingRow, Toggle } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { bundledReleases, openOnboarding, setTestEveryBuild, setWhatsNewEnabled, useOnboarding } from "../../lib/onboarding";
import { useUpdateStatus } from "../../lib/update";

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
      <SettingRow label={t("onboarding.whatsNewToggle")} hint={t("onboarding.whatsNewToggleHint")}>
        <Toggle checked={state.whatsNew} onChange={setWhatsNewEnabled} label={t("onboarding.whatsNewToggle")} />
      </SettingRow>
      <SettingRow label={t("onboarding.replayIntro")}>
        <Button onClick={() => openOnboarding({ kind: "intro" })}>{t("onboarding.replayIntro")}</Button>
      </SettingRow>
      {(devBuild || state.testEveryBuild) && (
        <SettingRow label={t("onboarding.testEveryBuild")} hint={t("onboarding.testEveryBuildHint")}>
          <Toggle checked={state.testEveryBuild} onChange={setTestEveryBuild} label={t("onboarding.testEveryBuild")} />
        </SettingRow>
      )}
      {version && (
        <SettingRow label={t("onboarding.replayWhatsNew")}>
          <Button onClick={() => openOnboarding({ kind: "whatsNew", version })}>{version}</Button>
        </SettingRow>
      )}
    </Section>
  );
}
