// 额度用完 · 14:32 自动继续 · 取消 (cutex claude-quota-auto-continue, lib/quotaContinue): the Claude
// agent's last turn hit its usage limit; cutex sends one continuation when the limit resets. A strip in
// the composer tray, like 委托已暂停 · 继续.
import { useState } from "react";
import { BatteryWarning } from "lucide-react";
import type { QuotaContinueView } from "../../../shared/quotaContinue";
import { useI18n } from "../i18n";
import { cancelQuotaContinue, continueClock } from "../lib/quotaContinue";
import { useClock } from "../lib/time";
import { useApp } from "../store";

export function QuotaContinueSection({ hostId, sessionId, view }: { hostId: string; sessionId: string; view: QuotaContinueView }) {
  const { t, locale } = useI18n();
  const now = useClock();
  const [busy, setBusy] = useState(false);
  const pending = view.pending;
  if (!pending) return null;
  const at = continueClock(pending.at, now, locale);
  const resetAt = pending.resetAt ? continueClock(pending.resetAt, now, locale) : null;
  const cancel = async () => {
    setBusy(true);
    try {
      await cancelQuotaContinue(hostId, sessionId);
    } catch (e) {
      useApp.getState().notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex h-6 items-center gap-2 px-2 text-[11px] text-warn-text" data-testid="quota-continue">
      <BatteryWarning size={12} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate" title={t("quotaContinue.hint", { reset: resetAt ?? "?", at })}>
        {t("quotaContinue.strip", { at })}
      </span>
      <button disabled={busy} onClick={() => void cancel()} title={t("quotaContinue.cancelHint")} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-foreground hover:text-accent disabled:opacity-50" data-testid="quota-continue-cancel">
        {t("quotaContinue.cancel")}
      </button>
    </div>
  );
}
