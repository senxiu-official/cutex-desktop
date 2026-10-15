// useStatus of the 计划 category: present while the thread has a plan snapshot. A live plan update
// bumps `pulse` (the collapsed capsule's border lights up briefly); a rebuilt timeline (agent
// re-opened, resync, restored from the local cache) is not an update, and neither is the agent
// clearing its list (the signature ignores the cleared flag; the kept list just greys out).
import { useRef } from "react";
import { CircleCheck, ListChecks, LoaderCircle } from "lucide-react";
import { useI18n } from "../../i18n";
import { latestPlan, planProgress, planSignature, type PlanSnapshot } from "../../lib/statusCapsule";
import { useSessionTimeline } from "../../lib/statusItemsView";
import type { StatusLine } from "../slots";

export function usePlanStatus(sessionId: string): { data: PlanSnapshot; line: StatusLine; pulse: number } | null {
  const { t } = useI18n();
  const timeline = useSessionTimeline(sessionId);
  const plan = latestPlan(timeline);
  const signature = planSignature(plan);
  const seen = useRef({ signature, timeline, pulse: 0 });
  if (seen.current.signature !== signature || seen.current.timeline !== timeline) {
    const live = !!signature && signature !== seen.current.signature && timeline === seen.current.timeline;
    seen.current = { signature, timeline, pulse: seen.current.pulse + (live ? 1 : 0) };
  }
  if (!plan) return null;
  const { done, total } = planProgress(plan.steps);
  const finished = done === total;
  if (plan.cleared) {
    const last = [...plan.steps].reverse().find((s) => s.status === "completed") ?? plan.steps[0] ?? null;
    return {
      data: plan,
      pulse: seen.current.pulse,
      line: {
        icon: <ListChecks size={14} className="shrink-0 text-subtle" />,
        text: <span className="text-subtle">{last?.step ?? t("plan.statusTitle")}</span>,
        title: `${t("plan.clearedHint")}
${last?.step ?? ""}`.trim(),
        trailing: (
          <span className="shrink-0 text-xs text-subtle tabular-nums">
            {t("plan.cleared")} · {done}/{total}
          </span>
        ),
      },
    };
  }
  const current = plan.steps.find((s) => s.status === "inProgress") ?? plan.steps.find((s) => s.status === "pending") ?? null;
  const step = current ?? [...plan.steps].reverse().find((s) => s.status === "completed") ?? null;
  return {
    data: plan,
    pulse: seen.current.pulse,
    line: {
      icon: finished ? (
        <CircleCheck size={14} className="shrink-0 text-ok" />
      ) : current?.status === "inProgress" ? (
        <LoaderCircle size={14} className="shrink-0 text-accent motion-safe:animate-spin" />
      ) : (
        <ListChecks size={14} className="shrink-0 text-subtle" />
      ),
      text: step?.step ?? t("plan.statusTitle"),
      title: step?.step ?? t("plan.statusTitle"),
      trailing: (
        <span className={`shrink-0 text-xs tabular-nums ${finished ? "text-ok-text" : "text-subtle"}`}>
          {done}/{total}
        </span>
      ),
    },
  };
}
