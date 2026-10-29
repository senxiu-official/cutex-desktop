import { useState } from "react";
import { Info, Trash2, X } from "lucide-react";
import { useI18n } from "../i18n";
import { useApp } from "../store";
import { dismissQueueInsert, insertDismissible, insertUnsure, queueInsertLabel, queueInsertFeedbackView, type QueueInsertFeedback } from "../lib/queueInsertFeedback";
import { useUserLayoutToggle } from "../lib/userLayoutToggle";

const TEXT_BUTTON = "shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-foreground hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none";
const ICON = "shrink-0 rounded p-0.5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none";

/**
 * One status slot per message; request outcomes never masquerade as current runtime health. The backend's
 * own words (`detail`) are only ever a 详情 tooltip. An unsure outcome (lib/steerOutcome: the resync could
 * not tell) offers 再发一次 / 已送达, and 删除 when it is a receipt (`inQueue`: the queued row has its own).
 */
export function QueueInsertStatus({ feedback, hostId, sessionId, inQueue = false }: { feedback: QueueInsertFeedback; hostId: string; sessionId: string; inQueue?: boolean }) {
  const { t } = useI18n();
  feedback = queueInsertFeedbackView(feedback);
  const unsure = insertUnsure(feedback);
  const text = [t(queueInsertLabel(feedback)), feedback.reason].filter(Boolean).join(" · ");
  const decide = (choice: "resend" | "delivered" | "forget") => void useApp.getState().queueInsertDecide(feedback.token, choice, sessionId, hostId);
  return (
    <span className={`flex min-w-0 ${unsure ? "max-w-[75%]" : "max-w-[60%]"} shrink items-center gap-1 text-caption ${feedback.state === "rejected" ? "text-danger-text" : unsure ? "text-warn-text" : "text-subtle"}`} data-testid="queue-insert-status" data-state={feedback.state} data-checking={feedback.checking || undefined}>
      <span className="min-w-0 truncate" role="status" aria-live="polite" title={unsure ? t("queue.insert.unsureHint") : text}>{text}</span>
      {feedback.detail && (!unsure || inQueue) && (
        <span className={`${ICON} cursor-help`} title={`${t("queue.insert.details")}: ${feedback.detail}`} aria-label={t("queue.insert.details")} data-testid="queue-insert-detail">
          <Info size={11} aria-hidden />
        </span>
      )}
      {unsure ? (
        <>
          <button className={TEXT_BUTTON} title={t("queue.insert.resendHint")} onClick={() => decide("resend")} data-testid="queue-insert-resend">{t("queue.insert.resend")}</button>
          <button className={TEXT_BUTTON} title={t("queue.insert.markDeliveredHint")} onClick={() => decide("delivered")} data-testid="queue-insert-delivered">{t("queue.insert.markDelivered")}</button>
          {!inQueue && (
            <button className={`${ICON} hover:text-danger`} title={t("queue.insert.forget")} aria-label={t("queue.insert.forget")} onClick={() => decide("forget")} data-testid="queue-insert-forget">
              <Trash2 size={11} aria-hidden />
            </button>
          )}
        </>
      ) : (
        insertDismissible(feedback.state) && !feedback.checking && <button className={ICON} title={t("common.close")} aria-label={t("common.close")} onClick={() => dismissQueueInsert(hostId, sessionId, feedback.token)}><X size={11} aria-hidden /></button>
      )}
    </span>
  );
}

/**
 * Under an unsure receipt: what to do next in plain words, and the backend's own words behind 详情
 * (a disclosure, not the row's text).
 */
export function QueueInsertUnsureHint({ feedback }: { feedback: QueueInsertFeedback }) {
  const { t } = useI18n();
  const userToggle = useUserLayoutToggle();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-0.5 pr-1 pb-0.5 pl-6 text-caption text-subtle" data-testid="queue-insert-unsure-hint">
      <span className="min-w-0">
        {t("queue.insert.unsureHint")}
        {feedback.detail && (
          <button className="ml-1.5 rounded px-0.5 text-muted underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none" aria-expanded={open} title={feedback.detail} onClick={() => userToggle(() => setOpen(!open))} data-testid="queue-insert-details-toggle">
            {t("queue.insert.details")}
          </button>
        )}
      </span>
      {open && feedback.detail && <span className="min-w-0 font-mono break-all text-subtle select-text" data-testid="queue-insert-raw">{feedback.detail}</span>}
    </div>
  );
}
