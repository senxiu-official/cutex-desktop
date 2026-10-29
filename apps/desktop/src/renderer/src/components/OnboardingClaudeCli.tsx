import { useRef, useState } from "react";
import { useI18n } from "../i18n";
import { loadComponents } from "../lib/componentStore";
import { useTargetApi } from "../lib/targetHost";

/** Normalized optional daemon metadata; absent on hosts predating bundled Claude Code. */
export interface OnboardingCliChoice {
  selected: "bundled" | "system";
  bundledVersion: string | null;
  systemVersion: string | null;
  systemDetected: boolean;
}

/** Host settings change only on a user choice, never while reading a missing preference. */
export function OnboardingClaudeCli({ choice, hostId, disabled }: { choice: OnboardingCliChoice; hostId: string; disabled: boolean }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const select = async (value: "bundled" | "system") => {
    if (disabled || pending.current || value === choice.selected) return;
    pending.current = true; setBusy(true); setFailed(false);
    try {
      await api.patchSettings({ claudeCli: value });
      await loadComponents(hostId);
    } catch { setFailed(true); }
    finally { pending.current = false; setBusy(false); }
  };
  const version = choice.selected === "bundled" ? choice.bundledVersion : choice.systemVersion;
  return <div className="mt-2 space-y-1 text-xs text-subtle" data-onboarding-cli-source={choice.selected}>
    <p>{t("onboarding.claudeRuntime.using", { source: t(`onboarding.claudeRuntime.${choice.selected}`), version: version ?? t("onboarding.claudeRuntime.versionUnknown") })}</p>
    {choice.systemDetected && <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("onboarding.claudeRuntime.choose")}>
      {(["bundled", "system"] as const).map(value => <button type="button" key={value} disabled={disabled || busy} aria-pressed={choice.selected === value} onClick={() => void select(value)} className={`rounded-md border px-2 py-1 disabled:opacity-50 ${choice.selected === value ? "border-accent/40 bg-accent/10 text-accent" : "border-border hover:bg-hover"}`}>
        {t(`onboarding.claudeRuntime.${value}`)}
      </button>)}
      {busy && <span role="status">{t("onboarding.claudeRuntime.saving")}</span>}
    </div>}
    {failed && <p role="alert" className="text-warn">{t("onboarding.claudeRuntime.saveFailed")}</p>}
  </div>;
}
