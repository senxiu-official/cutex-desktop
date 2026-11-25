// The steps a workflow retry wants checked first (workflowRetry.ts): the previous run's steps whose outcome is unconfirmed,
// each with its delegation (查看委托 opens its detail) and session ids, read from that run on the approval's host.
import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useI18n } from "../../i18n";
import { openDelegationDetail } from "../../lib/delegationOpen";
import { services } from "../app";
import { unconfirmedSteps, type UnconfirmedStep } from "./workflowRetry";

export function UnconfirmedSteps({ hostId, runId }: { hostId: string; runId: string }) {
  const { t } = useI18n();
  const [steps, setSteps] = useState<UnconfirmedStep[] | null | "failed">(null);
  useEffect(() => {
    let live = true;
    setSteps(null);
    services.daemonFor(hostId).workflowRun(runId, ["steps"])
      .then((run) => live && setSteps(unconfirmedSteps(run?.steps ?? [])))
      .catch(() => live && setSteps("failed"));
    return () => {
      live = false;
    };
  }, [hostId, runId]);
  return (
    <div className="mt-2 rounded-lg border border-warn/40 bg-warn/5 px-2.5 py-2 text-xs" data-unconfirmed-steps="">
      <p className="flex items-start gap-1.5 text-warn-text">
        <TriangleAlert size={13} className="mt-px shrink-0" />
        {t("approvals.workflow.unconfirmed")}
      </p>
      {steps === null ? (
        <p className="mt-1 text-subtle">{t("approvals.workflow.unconfirmedLoading")}</p>
      ) : steps === "failed" || steps.length === 0 ? (
        <p className="mt-1 text-subtle">{t("approvals.workflow.unconfirmedUnread", { run: runId })}</p>
      ) : (
        <ul className="mt-1.5 flex flex-col gap-1">
          {steps.map((s) => (
            <li key={s.stepKey} className="min-w-0" data-unconfirmed-step={s.why}>
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="min-w-0 truncate font-medium text-foreground" title={s.stepKey}>{s.label}</span>
                <span className="shrink-0 text-warn-text">{t(s.why === "live" ? "approvals.workflow.stepLive" : "approvals.workflow.stepUnknown")}</span>
              </div>
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 text-subtle">
                {s.askIds.map((askId) => (
                  <span key={askId} className="inline-flex min-w-0 items-baseline gap-1">
                    {t("approvals.workflow.stepAsk")}
                    <code className="selectable font-mono text-muted">{askId}</code>
                    <button type="button" className="text-accent hover:underline" onClick={() => openDelegationDetail(hostId, askId)}>
                      {t("delegation.step.next.delegation")}
                    </button>
                  </span>
                ))}
                {s.sessionId && (
                  <span className="inline-flex min-w-0 items-baseline gap-1">
                    {t("approvals.workflow.stepSession")}
                    <code className="selectable font-mono text-muted">{s.sessionId}</code>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
