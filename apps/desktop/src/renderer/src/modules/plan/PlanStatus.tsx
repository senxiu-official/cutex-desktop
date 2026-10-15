// The 计划 status category (DESIGN §4.20): the model's latest `update_plan` snapshot in its own
// order, focus-windowed (已完成 / 待处理 disclosures). Capsule header = done/total; status row chip
// 进程 2/4 opening the same list. The last non-empty list stays (lib/planState): greyed with 已清空
// once the agent emptied it; the eye-off button hides it until a different list arrives.
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, EyeOff, ListChecks } from "lucide-react";
import { PlanStepRow } from "./PlanCard";
import { StatusChip } from "../../components/StatusChip";
import { ProgressLine } from "../../components/ProgressLine";
import { CAPSULE_LINE, CAPSULE_ROW_ICON } from "../../lib/capsuleRows";
import { useI18n, type MessageKey } from "../../i18n";
import { focusWindow, foldKind, latestPlan, planProgress, type PlanSnapshot, type PlanStep } from "../../lib/statusCapsule";
import { useSessionTimeline } from "../../lib/statusItemsView";
import { useApp } from "../../store";
import type { StatusBarProps } from "../slots";

/** "已完成 3 项" / "待处理 4 项": a disclosure whose rows open right below it (DESIGN §4.17). */
function Fold({ label, open, onToggle, children }: { label: string; open: boolean; onToggle(): void; children: ReactNode }) {
  return (
    <>
      <li>
        <button onClick={onToggle} aria-expanded={open} data-capsule-line="" className={`${CAPSULE_LINE} gap-2 hover:bg-hover hover:text-foreground`}>
          <span className={CAPSULE_ROW_ICON}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
          {label}
        </button>
      </li>
      {open && children}
    </>
  );
}

/** The model's steps in its own order: done ones folded above, the current window, the rest below. */
function PlanSteps({ steps }: { steps: PlanStep[] }) {
  const { t } = useI18n();
  const [showBefore, setShowBefore] = useState(false);
  const [showAfter, setShowAfter] = useState(false);
  const w = focusWindow(steps);
  const label = (group: "before" | "after", items: PlanStep[]) => t(`plan.fold.${foldKind(group, items)}` as MessageKey, { n: items.length });
  const rows = (items: PlanStep[], offset: number) => items.map((s, i) => <PlanStepRow key={offset + i} step={s} row className="rounded-lg px-2 py-1.5 leading-5" />);
  return (
    <ul className="text-[13px]">
      {w.before.length > 0 && (
        <Fold label={label("before", w.before)} open={showBefore} onToggle={() => setShowBefore(!showBefore)}>
          {rows(w.before, 0)}
        </Fold>
      )}
      {rows(w.focus, w.before.length)}
      {w.after.length > 0 && (
        <Fold label={label("after", w.after)} open={showAfter} onToggle={() => setShowAfter(!showAfter)}>
          {rows(w.after, w.before.length + w.focus.length)}
        </Fold>
      )}
    </ul>
  );
}

/**
 * "已清空" tag (the agent emptied its list; this is the one before) and the hide button: an eye-off
 * icon, not a ×, so it never reads as the card's own close (UI review #19).
 */
function PlanTools({ sessionId, plan }: { sessionId: string; plan: PlanSnapshot }) {
  const { t } = useI18n();
  return (
    <>
      {plan.cleared && (
        <span className="rounded bg-surface-2 px-1 text-[11px] text-subtle" title={t("plan.clearedHint")}>
          {t("plan.cleared")}
        </span>
      )}
      <button
        onClick={() => useApp.getState().dismissPlan(sessionId)}
        title={t("plan.dismissHint")}
        aria-label={t("plan.dismiss")}
        className="flex size-5 items-center justify-center rounded text-subtle hover:bg-surface-2 hover:text-foreground"
      >
        <EyeOff size={12} />
      </button>
    </>
  );
}

/** The list with its progress as a 2px bar on top (done / total; the numbers are in the header). */
function PlanList({ plan }: { plan: PlanSnapshot }) {
  const { done, total } = planProgress(plan.steps);
  return (
    <div className={plan.cleared ? "opacity-60" : undefined}>
      <div data-capsule-line="" className="px-2 pb-1.5">
        <ProgressLine ratio={total ? done / total : 0} />
      </div>
      {plan.explanation && <p data-capsule-line="" className="px-2 pb-1 text-xs text-muted italic">{plan.explanation}</p>}
      <PlanSteps key={plan.turnId} steps={plan.steps} />
    </div>
  );
}

export function PlanMeta({ sessionId, data: plan }: { sessionId: string; data: PlanSnapshot }) {
  const { done, total } = planProgress(plan.steps);
  return (
    <>
      <span className={done === total && !plan.cleared ? "text-foreground" : ""}>{done}/{total}</span>
      <PlanTools sessionId={sessionId} plan={plan} />
    </>
  );
}

export function PlanBody({ data: plan }: { sessionId: string; data: PlanSnapshot }) {
  return <PlanList plan={plan} />;
}

/** Status-row chip 进程 2/4 with the list floating up. */
export function PlanStatusBar({ sessionId, inline }: StatusBarProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const plan = latestPlan(useSessionTimeline(sessionId));
  if (!inline || !plan) return null;
  const { done, total } = planProgress(plan.steps);
  return (
    <StatusChip
      open={open}
      onOpenChange={setOpen}
      className={plan.cleared ? "text-subtle" : done === total ? "text-accent" : "text-muted"}
      panelClassName="right-6 w-96"
      label={
        <>
          <ListChecks size={13} />
          {t("plan.count", { done, total })}
          {plan.cleared && <span className="text-[11px]">· {t("plan.cleared")}</span>}
        </>
      }
    >
      <div className="flex items-center justify-end gap-1.5 px-1 pb-1">
        <PlanTools sessionId={sessionId} plan={plan} />
      </div>
      <PlanList plan={plan} />
    </StatusChip>
  );
}
