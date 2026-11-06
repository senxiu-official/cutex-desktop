import { useCallback, useRef } from "react";
import { useOnboardingInteraction } from "../lib/onboardingInteraction";
// 「要看引导和提示吗？」 (owner 2026-10-24, lib/guides): asked once per device, the first time any guide would show.
// 看 = go on (the guide that was about to show does); 全部跳过 = every live guide counts as seen (a second device). Used
// before the automatic onboarding (components/OnboardingDialog) and inside the first tip (components/FirstUseTips).
import { useI18n } from "../i18n";
import { answerGuides, skipAllGuides, useHostSkippedBefore } from "../lib/guides";
import { useTrackOverlay } from "../lib/openOverlays";
import { Button } from "./settings/Form";

/** The question's two buttons (inline: inside a tip). */
export function GuidesAskButtons({ version, onSkip }: { version: string | null; onSkip?: () => void }) {
  const { t } = useI18n();
  // Skipped on another device before (cutex guides.preferences): 全部跳过 is the preselected answer.
  const skipFirst = useHostSkippedBefore();
  return (
    <div className="flex items-center gap-2" data-guides-preselected={skipFirst ? "skip" : "see"}>
      <span data-guides-answer="see">
        <Button primary={!skipFirst} onClick={answerGuides}>
          {t("onboarding.guide.ask.see")}
        </Button>
      </span>
      <span data-guides-answer="skip">
      <Button
        primary={skipFirst}
        onClick={() => {
          skipAllGuides(version);
          onSkip?.();
        }}
      >
        {t("onboarding.guide.ask.skipAll")}
      </Button>
      </span>
    </div>
  );
}

/** Before the first automatic onboarding: a small card, not the flow. */
export function GuidesAsk({ version }: { version: string | null }) {
  const { t } = useI18n();
  useTrackOverlay(true);
  const box = useRef<HTMLDivElement>(null);
  const skip = useCallback(() => skipAllGuides(version), [version]);
  useOnboardingInteraction(box, skip);
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/35 p-4">
      <div ref={box} tabIndex={-1} role="dialog" aria-modal aria-label={t("onboarding.guide.ask.title")} data-guides-ask="" className="w-[30rem] max-w-full rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <h2 className="text-display text-foreground">{t("onboarding.guide.ask.title")}</h2>
        <p className="mt-2 whitespace-pre-line text-ui text-muted">{t("onboarding.guide.ask.body")}</p>
        <div className="mt-5 flex justify-end">
          <GuidesAskButtons version={version} />
        </div>
      </div>
    </div>
  );
}
