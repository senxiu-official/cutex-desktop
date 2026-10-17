// Decisions of Codex's automatic approval reviewer (「自动」 mode): a line under the tool row it
// reviewed, or a notice row for a review without a tool item (network access) / a reviewer warning.
import { useState } from "react";
import { Loader2, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import type { AutoReview } from "../lib/timeline";

const STATUS_KEY: Record<AutoReview["status"], MessageKey> = {
  inProgress: "autoReview.inProgress",
  approved: "autoReview.approved",
  denied: "autoReview.denied",
  timedOut: "autoReview.timedOut",
  aborted: "autoReview.aborted",
};

const RISK_KEY: Record<NonNullable<AutoReview["riskLevel"]>, MessageKey> = {
  low: "autoReview.risk.low",
  medium: "autoReview.risk.medium",
  high: "autoReview.risk.high",
  critical: "autoReview.risk.critical",
};

function ReviewIcon({ status }: { status: AutoReview["status"] }) {
  if (status === "inProgress") return <Loader2 size={12} className="shrink-0 animate-spin text-accent" />;
  if (status === "approved") return <ShieldCheck size={12} className="shrink-0 text-ok" />;
  if (status === "denied") return <ShieldAlert size={12} className="shrink-0 text-danger" />;
  return <ShieldQuestion size={12} className="shrink-0 text-warn" />;
}

/** What a review without a tool row was about (network: the host). */
function actionText(review: AutoReview, t: ReturnType<typeof useI18n>["t"]): string | null {
  const action = review.action;
  if (!action) return null;
  if (action.type === "networkAccess") return t("autoReview.action.network", { host: action.port ? `${action.host}:${action.port}` : action.host });
  if (action.type === "command") return action.command;
  if (action.type === "execve") return [action.program, ...action.argv.slice(1)].join(" ");
  if (action.type === "applyPatch") return action.files.join(", ");
  if (action.type === "mcpToolCall") return action.toolTitle ?? `${action.server}.${action.toolName}`;
  if (action.type === "requestPermissions") return action.reason ?? t("autoReview.action.permissions");
  return null;
}

/** The reviewer's verdict on one escalation: status, risk, and its reason (expandable). */
export function AutoReviewLine({ review, standalone = false }: { review: AutoReview; standalone?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const reason = review.rationale;
  const risk = review.riskLevel ? t(RISK_KEY[review.riskLevel]) : null;
  const subject = standalone ? actionText(review, t) : null;
  const tone = review.status === "denied" ? "text-danger" : review.status === "approved" ? "text-muted" : "text-subtle";
  return (
    <div className={standalone ? "my-0.5 text-xs" : "mt-0.5 ml-5 text-[11px]"} title={t("autoReview.hint")}>
      <button onClick={() => reason && setOpen(!open)} className={`flex max-w-full items-center gap-1 text-left ${reason ? "hover:text-foreground" : "cursor-default"}`}>
        <ReviewIcon status={review.status} />
        <span className={`shrink-0 ${tone}`}>{t(STATUS_KEY[review.status])}</span>
        {risk && <span className="shrink-0 text-subtle">· {risk}</span>}
        {subject && <code className="min-w-0 truncate font-mono text-subtle">{subject}</code>}
        {reason && !open && review.status !== "approved" && <span className="min-w-0 truncate text-subtle">— {reason.replace(/\s+/g, " ")}</span>}
      </button>
      {open && reason && <p className="mt-0.5 ml-4 whitespace-pre-wrap break-words text-subtle">{reason}</p>}
    </div>
  );
}

/** A reviewer notice row (lib/timeline `notice` entries). */
export function AutoReviewNotice({ review, text }: { review?: AutoReview; text?: string }) {
  const { t } = useI18n();
  if (review) return <AutoReviewLine review={review} standalone />;
  if (!text) return null;
  return (
    <div className="my-0.5 flex max-w-full items-start gap-1 text-xs text-subtle" title={t("autoReview.hint")}>
      <ShieldQuestion size={12} className="mt-0.5 shrink-0 text-warn" />
      <span className="shrink-0">{t("autoReview.notice")}</span>
      <span className="min-w-0 break-words">{text}</span>
    </div>
  );
}
