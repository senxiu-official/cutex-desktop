// A button of the onboarding / guides that runs a lib/guideActions action: disabled with the reason when it cannot
// run now (never a silent no-op).
import type { ReactNode } from "react";
import { useI18n } from "../i18n";
import { guideActionBlocked, runGuideAction, type GuideAction } from "../lib/guideActions";
import { useApp } from "../store";

/** `before`: runs first (e.g. closes the dialog it is in); `children`: the label. */
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
