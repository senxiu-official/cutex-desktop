// A delegation's current blocker and next step (lib/activityStep), e.g. 「等验收 · 查看结果」: the blocker as words, the
// next step as a link button only when it navigates (等待 stays text). `blocker={false}` shows the button alone, for a
// delegation's own surfaces whose status word already says the state.
import type { MouseEvent } from "react";
import { useI18n } from "../i18n";
import { blockerKey, nextKey, type ActivityStep } from "../lib/activityStep";
import { openStepAction } from "../lib/activityOpen";

type Key = Parameters<ReturnType<typeof useI18n>["t"]>[0];

export function ActivityStepChip({ step, hostId, askId, title, blocker = true, fallback, className = "" }: {
  step: ActivityStep;
  /** The record's host and ask id (the row's, never the focus host). */
  hostId: string;
  askId: string;
  title?: string;
  blocker?: boolean;
  /** The row's old opener, when the detail cannot open here. */
  fallback?: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const next = nextKey(step);
  const action = step.action;
  if (!blocker && !action) return null;
  const go = (e: MouseEvent) => {
    e.stopPropagation();
    if (action) openStepAction(hostId, askId, action, { title, fallback });
  };
  return (
    <span className={`inline-flex min-w-0 items-baseline gap-1 text-caption/[inherit] ${className}`} data-activity-step={step.blocker} data-activity-next={step.next}>
      {blocker && <span className="min-w-0 truncate text-warn-text">{t(blockerKey(step.blocker) as Key)}</span>}
      {blocker && next && <span className="shrink-0 text-subtle" aria-hidden>·</span>}
      {next && action ? (
        <button type="button" onClick={go} className="shrink-0 rounded-sm text-accent hover:underline focus-visible:outline focus-visible:outline-accent" data-activity-step-action={action.kind}>
          {t(next as Key)}
        </button>
      ) : next ? (
        <span className="shrink-0 text-subtle">{t(next as Key)}</span>
      ) : null}
    </span>
  );
}
