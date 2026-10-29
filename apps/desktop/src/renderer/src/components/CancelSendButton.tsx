// 「取消发送」 with the in-place second confirm (medium risk, design 013): the first click arms, the second cancels.
import { useState } from "react";
import { useI18n } from "../i18n";
import { ARMED_BUTTON, useArmed } from "../lib/armedConfirm";

export function CancelSendButton({ onCancel }: { onCancel(): Promise<{ ok: true } | { ok: false; error: string }> }) {
  const { t } = useI18n();
  const [armed, setArmed] = useArmed();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setArmed(false);
    setBusy(true);
    const r = await onCancel();
    setBusy(false);
    setError(r.ok ? null : r.error);
  };
  if (error)
    return (
      <span className="shrink-0 text-caption/[inherit] text-danger" title={error} data-testid="cancel-send-error">
        {t("cancelSend.failed")}
      </span>
    );
  return armed ? (
    <button type="button" className={`${ARMED_BUTTON} shrink-0`} disabled={busy} onClick={() => void run()} data-testid="cancel-send-confirm">
      {t("cancelSend.confirm")}
    </button>
  ) : (
    <button type="button" disabled={busy} onClick={() => setArmed(true)} title={t("cancelSend.hint")} className="shrink-0 rounded-md px-1.5 py-0.5 text-caption/[inherit] text-muted hover:text-danger disabled:opacity-50" data-testid="cancel-send">
      {t("cancelSend.action")}
    </button>
  );
}
