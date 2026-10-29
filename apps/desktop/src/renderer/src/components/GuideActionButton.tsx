// A button of the onboarding / guides that runs a lib/guideActions action: disabled with the reason when it cannot
// run now (never a silent no-op), and the 「回到引导」 pill the flow leaves behind when one of its actions runs.
import type { ReactNode } from "react";
import { CornerUpLeft, X } from "lucide-react";
import { useI18n } from "../i18n";
import { guideActionBlocked, runGuideAction, type GuideAction } from "../lib/guideActions";
import { dismissOnboardingAside, resumeOnboarding, useOnboardingAside } from "../lib/onboarding";
import { useApp } from "../store";

/** `before`: runs first (the flow steps aside); `children`: the label. */
export function GuideActionButton({ action, before, className, children, id }: { action: GuideAction; before?: () => void; className: string; children: ReactNode; id?: string }) {
  const { t } = useI18n();
  // Re-checked when what the preconditions read changes (an agent opened or listed).
  useApp((s) => `${s.selectedId ?? ""} ${s.sidebar?.active.length ?? 0}`);
  const blocked = guideActionBlocked(action);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        data-guide-action={id ?? action.kind}
        disabled={!!blocked}
        aria-describedby={blocked ? `${id ?? action.kind}-why` : undefined}
        onClick={() => {
          before?.();
          void runGuideAction(action);
        }}
        className={`${className} disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {children}
      </button>
      {blocked && (
        <span id={`${id ?? action.kind}-why`} data-guide-action-blocked="" className="text-xs text-muted">
          {t(blocked)}
        </span>
      )}
    </span>
  );
}

/** After a card's action: 「回到引导」 at the bottom of the window until it is used or dismissed. */
export function OnboardingAsidePill() {
  const { t } = useI18n();
  const aside = useOnboardingAside();
  if (!aside) return null;
  return (
    <div role="status" data-onboarding-aside={aside.at ?? ""} className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-surface py-1 pl-3 pr-1 text-sm shadow-e2">
      <button type="button" data-onboarding-resume="" onClick={resumeOnboarding} className="inline-flex items-center gap-1.5 rounded-full px-1 text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent">
        <CornerUpLeft size={14} aria-hidden="true" />
        {t("onboarding.aside.back")}
      </button>
      <button type="button" aria-label={t("onboarding.aside.dismiss")} title={t("onboarding.aside.dismiss")} onClick={dismissOnboardingAside} className="rounded-full p-1 text-muted hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent">
        <X size={14} />
      </button>
    </div>
  );
}
