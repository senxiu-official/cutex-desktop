// A host read that failed, as panels show it (owner 2026-11-16): a plain line — 「… 暂时读不出，正在重试…」 while
// it retries by itself, 「… 读不出」 otherwise — with the raw code in the tooltip, and always 重新加载.
import { RotateCw } from "lucide-react";
import { useI18n } from "../i18n";
import type { ReadIssue } from "../lib/transientError";

export function ReadIssueLine({ issue, retryingText, failedText, onReload, className = "" }: { issue: ReadIssue; retryingText: string; failedText: string; onReload: () => void; className?: string }) {
  const { t } = useI18n();
  return (
    <div role="status" data-read-issue={issue.retrying ? "retrying" : "failed"} title={issue.detail} className={`flex min-w-0 items-center gap-2 text-meta/[inherit] ${issue.retrying ? "text-subtle" : "text-warn"} ${className}`}>
      <span className="min-w-0">{issue.retrying ? retryingText : failedText}</span>
      <button type="button" onClick={onReload} className="inline-flex shrink-0 items-center gap-1 rounded px-1 text-accent hover:bg-hover hover:underline">
        <RotateCw size={11} />
        {t("readIssue.reload")}
      </button>
    </div>
  );
}
