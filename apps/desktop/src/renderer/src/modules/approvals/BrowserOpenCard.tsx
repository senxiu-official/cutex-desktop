// 「{{agent}}想打开网页」 in the requesting agent's conversation (BrowserClaimOverlay): a pending
// browser_open (设置 → 浏览器 → 「{{agent}}自开页面审批」 = 每次审批) decided where the agent works, like a
// claim, instead of only on 审批. Same decision as the 审批 page: approves this one opening intent.
import { useState } from "react";
import { Globe } from "lucide-react";
import type { ApprovalRecord } from "../../../../shared/ipc";
import { browserOwnerErrorKey } from "../../../../shared/browser";
import { bridge } from "../../bridge";
import { useI18n, type MessageKey } from "../../i18n";
import { approvalFacts } from "../../lib/approvals";
import { ApprovalSource } from "../../components/ApprovalSource";

export function BrowserOpenCard({ hostId, approval }: { hostId: string; approval: ApprovalRecord }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const facts = approvalFacts(approval.details, "browser_open");
  const fieldLabel = (key: string) => {
    const k = `approvals.field.${key}` as MessageKey;
    return t(k) === k ? key : t(k);
  };
  const decide = async (decision: "approve" | "deny") => {
    if (!bridge.apiFor) return setError(t(browserOwnerErrorKey("browser_unavailable")));
    setBusy(true);
    setError(null);
    try {
      const r = await bridge.apiFor(hostId).decideApproval(approval.approvalId, decision);
      if (!r.ok) setError(r.error.code === "approval_not_pending" ? t("approvals.alreadyDecided") : t(browserOwnerErrorKey(r.error.code)));
    } catch (e) {
      setError(t(browserOwnerErrorKey(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-browser-open-card>
      <div className="flex items-center gap-2 pr-5 text-sm font-medium">
        <Globe size={14} className="shrink-0 text-accent" />
        <span className="min-w-0 truncate">{t("approvals.open.title", { name: approval.requesterName ?? "" })}</span>
        <ApprovalSource source="cutex" className="ml-auto" />
      </div>
      {facts.length > 0 && (
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {facts.map((f) => (
            <div key={f.key} className="contents">
              <dt className="text-subtle">{fieldLabel(f.key)}</dt>
              <dd className={`min-w-0 truncate ${f.mono ? "font-mono" : ""}`} title={f.value}>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-1.5 text-xs text-subtle">{t("approvals.browser.agentLogin")}</p>
      <div className="mt-2 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[11px] text-subtle" title={t("approvals.open.skipHint")}>{t("approvals.open.skipHint")}</span>
        <button type="button" disabled={busy} onClick={() => void decide("deny")} className="rounded-md border border-border px-3 py-1 text-xs hover:bg-hover disabled:opacity-40">{t("approvals.deny")}</button>
        <button type="button" disabled={busy} onClick={() => void decide("approve")} title={t("approvals.browser.retryHint")} className="rounded-md bg-accent px-3 py-1 text-xs text-white disabled:opacity-40">{t("approvals.browser.approveOpen")}</button>
      </div>
      {error && <p className="mt-1 truncate text-xs text-danger" title={error}>{error}</p>}
    </div>
  );
}
