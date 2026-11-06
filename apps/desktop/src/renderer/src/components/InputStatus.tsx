import { useEffect, useRef, useState } from "react";
import type { InputRecord } from "@cutex-desktop/protocol";
import { useI18n, type MessageKey } from "../i18n";
import { inputLabel } from "../lib/inputLedger/labels";
import { useApp } from "../store";
import { bridge } from "../bridge";
import { useNow } from "../lib/time";

/**
 * Shared by timeline and queue. Status and offered actions come only from this record.
 * `timeline`: on a timeline row, being there already says it arrived, so plain 已接收 (accepted) is silent like
 * 已进入上下文 (owner 2026-11-05). A silent row with nothing else to show keeps only a screen-reader label, no line.
 */
export function InputStatus({ record, sessionId, hostId, readOnly = false, timeline = false }: { record: InputRecord; sessionId: string; hostId?: string; readOnly?: boolean; timeline?: boolean }) {
  const { t } = useI18n();
  const label = inputLabel(record);
  const [pending, setPending] = useState(false);
  const pendingAction = useRef(false);
  const countdown = record.reason === "resultCoalescing" ? Date.parse(record.deadline ?? "") : NaN;
  const now = useNow(!!record.stalled || Number.isFinite(countdown));
  const unknownCode = label.kind === "unknown" ? `${label.field}:${label.code}` : null;
  useEffect(() => {
    if (unknownCode) bridge.shell?.logError({ kind: "reported", message: `input-ledger unknown status ${unknownCode} (${record.inputId})` });
  }, [unknownCode, record.inputId]);
  const act = async (action: "retry" | "dismiss" | "interruptSend") => {
    if (pendingAction.current) return;
    pendingAction.current = true;
    setPending(true);
    try {
      const app = useApp.getState();
      await (action === "interruptSend" ? app.interruptSendInput(sessionId, record.inputId, hostId)
        : action === "retry" ? app.retryInput(sessionId, record.inputId, hostId) : app.dismissInput(sessionId, record.inputId, hostId));
    } catch (error) {
      useApp.getState().notify(String(error), "error", { hostId: hostId ?? "local", sessionId });
    } finally { pendingAction.current = false; setPending(false); }
  };
  const unread = record.state === "accepted" && record.surface === "pendingNotes";
  const silent = label.kind === "label" && !unread && (label.id === "inContext" || (timeline && label.id === "accepted"));
  const status = label.kind === "unknown" ? label.code : silent ? "" : unread ? t("inputLedger.record.unread") : t(`inputLedger.record.${label.id}` as MessageKey);
  const diagnostics = [record.reason, record.stage, record.error?.code, record.error && JSON.stringify(record.error.details), record.details.nativeReason].filter(Boolean).join(" · ");
  const waitingHint = record.state === "waiting" && label.kind === "label";
  const detail = waitingHint && label.id !== "uncertain" ? status : diagnostics;
  const minutes = record.stalled ? Math.max(0, Math.floor((now - Date.parse(record.stalled.since)) / 60000)) : 0;
  const offered = readOnly ? [] : (record.actions ?? []).filter(action => action === "retry" || action === "dismiss" || action === "interruptSend");
  const failedCode = (record.state === "failed" || record.state === "rejected") && (record.error?.code || record.reason);
  if (silent && !failedCode && !Number.isFinite(countdown) && !record.stalled && !offered.length)
    return <span className="sr-only" data-testid="input-status" data-state={record.state} data-input-id={record.inputId}>{t(`inputLedger.record.${label.id}` as MessageKey)}</span>;
  return <span className="inline-flex h-5 min-w-0 max-w-full items-center gap-1 text-caption text-subtle" data-testid="input-status" data-state={record.state} data-input-id={record.inputId}>
    {status && <span className={`min-w-0 truncate ${label.kind === "unknown" || label.id === "uncertain" ? "text-warn-text" : record.state === "failed" ? "text-danger-text" : ""}`} data-tip={detail || undefined}>{status}</span>}
    {failedCode && <span className="truncate" data-tip={detail}>{record.error?.code ?? record.reason}</span>}
    {Number.isFinite(countdown) && <span className="tabular-nums">{t("queue.meta.countdown", { n: Math.max(0, Math.ceil((countdown - now) / 1000)) })}</span>}
    {label.kind === "unknown" && <span role="img" aria-label={t("inputLedger.unknown")} data-tip={t("inputLedger.unknown")}>⚠</span>}
    {record.stalled && <span className="truncate text-warn-text" data-tip={waitingHint ? status : record.stalled.reason}>{t("inputLedger.stalled", { n: minutes, reason: waitingHint ? status : record.stalled.reason })}</span>}
    {!readOnly && record.actions?.includes("retry") && <button type="button" disabled={pending} onClick={() => void act("retry")} className="h-5 shrink-0 rounded px-1 hover:bg-surface-2 disabled:opacity-50">{t("inputLedger.retry")}</button>}
    {!readOnly && record.actions?.includes("dismiss") && <button type="button" disabled={pending} onClick={() => void act("dismiss")} className="h-5 shrink-0 rounded px-1 hover:bg-surface-2 disabled:opacity-50">{t(record.kind === "delegationStatus" ? "inputLedger.ignoreNotification" : "inputLedger.dismiss")}</button>}
    {!readOnly && record.actions?.includes("interruptSend") && <button type="button" disabled={pending} onClick={() => void act("interruptSend")} className="h-5 shrink-0 rounded px-1 hover:bg-surface-2 disabled:opacity-50">{t("steer.interruptSend")}</button>}
  </span>;
}
