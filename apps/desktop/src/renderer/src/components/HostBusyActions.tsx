import { X } from "lucide-react";
import { useI18n } from "../i18n";
import { dismissHostBusyAction, useHostBusyActions } from "../lib/hostBusyActions";

/** Persistent, local owner-operation feedback; a busy refusal never changes the session resource. */
export function HostBusyActions() {
  const { t } = useI18n();
  const rows = useHostBusyActions(s => s.rows);
  if (!rows.length) return null;
  return <div className="fixed bottom-4 right-4 z-[150] flex max-h-[40vh] max-w-[min(30rem,calc(100vw-2rem))] flex-col gap-2 overflow-auto" data-testid="host-busy-actions">
    {rows.map(row => <div key={row.key} role="status" className="flex min-w-0 items-center gap-2 rounded-lg border border-card-border bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="min-w-0 flex-1">
        <div className="truncate text-muted">{t(row.kind === "delete" ? "menu.delete" : row.kind === "archive" ? "menu.archive" : "menu.start")} · {row.name}</div>
        <div title={row.detail}>{t(row.state === "retrying" ? "hostAction.retrying" : row.state === "cancelled" ? "hostAction.cancelled" : row.state === "uncertain" ? "hostAction.uncertain" : "hostAction.exhausted")}</div>
      </div>
      {row.state !== "retrying" && <>
        {row.state === "exhausted" && <button className="shrink-0 rounded px-2 py-1 text-accent hover:bg-surface-2" onClick={row.retry}>{t("hostAction.retry")}</button>}
        <button aria-label={t("common.close")} onClick={() => dismissHostBusyAction(row.key)} className="shrink-0 rounded p-1 hover:bg-surface-2"><X size={14}/></button>
      </>}
    </div>)}
  </div>;
}
