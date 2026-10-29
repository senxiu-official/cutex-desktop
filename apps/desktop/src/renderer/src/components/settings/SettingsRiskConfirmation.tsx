import { useEffect } from "react";
import { useI18n } from "../../i18n";
import { settingsRiskText } from "../../lib/settingsRiskText";
import { ARMED_FORM_BUTTON, useArmed } from "../../lib/armedConfirm";
import { Button } from "./Form";

export function SettingsRiskConfirmation({ message, valid, busy, confirmLabel, onConfirm, onCancel }: {
  message: string; valid(): boolean; busy?: boolean; confirmLabel?: string; onConfirm(): void; onCancel(): void;
}) {
  useI18n();
  const live = valid();
  const [armed, setArmed] = useArmed(valid);
  useEffect(() => setArmed(live), [live, valid, setArmed]);
  if (!live || !armed) return null;
  return <div role="group" aria-label={message} data-settings-risk-confirm className="my-2 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-xs">
    <p className="mb-2 break-words text-warn">{message}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={ARMED_FORM_BUTTON} disabled={busy} onClick={() => { if (valid()) { setArmed(false); onConfirm(); } }}>{confirmLabel ?? settingsRiskText("settingsRisk.confirm")}</button>
      <Button disabled={busy} onClick={onCancel}>{settingsRiskText("settingsRisk.cancel")}</Button>
    </div>
  </div>;
}
