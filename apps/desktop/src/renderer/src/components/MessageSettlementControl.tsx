import { useState } from "react";
import type { MessageSettlement } from "@cutex-desktop/protocol";
import { messageSettlementAllowed, mergeMessageSettlement, readMessageSettlement } from "../../../shared/messageSettlement";
import { useI18n } from "../i18n";
import { featuresOf, useApp } from "../store";
import { useAgentMessage } from "../lib/agentMessageStore";
import { useHostAccess } from "../lib/hostAccess";
import { closeMessageFollowUp, recheckSettlement, settlementWriteKey, useSettlementWrites } from "../lib/messageSettlementWrites";

/** Kept outside any row's main button: confirmation and reason are accessible inline controls. */
interface SettlementControlProps {
  hostId: string;
  messageId: string;
  settlement?: MessageSettlement;
  sessionId?: string;
  onRefresh?: () => Promise<void>;
}

export function MessageSettlementControl(props: SettlementControlProps) {
  const record = useAgentMessage(props.messageId);
  const write = useSettlementWrites((s) => s.entries[settlementWriteKey(props.hostId, props.messageId)]);
  if (!props.settlement && !record?.settlement && !write?.request) return null;
  return <SettlementControl key={settlementWriteKey(props.hostId, props.messageId)} {...props} />;
}

function SettlementControl({ hostId, messageId, settlement: snapshot, sessionId, onRefresh }: SettlementControlProps) {
  const { t } = useI18n();
  const features = useApp((s) => featuresOf(s, hostId));
  const access = useHostAccess(hostId);
  const supported = messageSettlementAllowed(features, access);
  const record = useAgentMessage(messageId);
  const write = useSettlementWrites((s) => s.entries[settlementWriteKey(hostId, messageId)]);
  const validated = readMessageSettlement(snapshot);
  const cached = validated?.state === "closed" ? validated : record?.settlementKnown ? record.settlement : mergeMessageSettlement(validated, record?.settlement);
  const settlement = write?.authoritative
    ? mergeMessageSettlement(cached?.state === "closed" ? cached : undefined, write.settlement)
    : mergeMessageSettlement(cached, write?.settlement);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const busy = write?.phase === "pending";
  const button = "shrink-0 rounded-md border border-border px-2 py-0.5 text-xs text-muted hover:text-foreground disabled:opacity-50";
  if (settlement?.state === "closed") return (
    <div className="min-w-0 text-xs text-subtle [overflow-wrap:anywhere]" data-testid="message-settlement-closed">
      <span title={t("agent-bus.settlement.disclaimer")}>{t("agent-bus.settlement.closed")}</span>
      {settlement.closure && <span className="ml-1" title={`${settlement.closure.actor} · ${settlement.closure.closedAt}`}>· {settlement.closure.reason}</span>}
    </div>
  );
  // Retain recovery for an uncertain write, but never offer another close on a delivered item.
  if (!supported || (record?.state === "delivered" && !write?.request) || (!settlement?.canClose && !write?.request)) return null;
  const retry = !!write?.request;
  return (
    <div className={`${open ? "w-full" : "shrink-0"} min-w-0 text-xs`} data-testid="message-settlement-control" onClick={(event) => event.stopPropagation()}>
      {!open ? <button type="button" className={button} disabled={busy} onClick={() => setOpen(true)}>{t(settlement?.canClose ? "agent-bus.settlement.close" : "agent-bus.settlement.recheck")}</button> : (
        <div className="my-1 flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 p-2" aria-busy={busy}>
          <p className="w-full text-muted">{t("agent-bus.settlement.disclaimer")}</p>
          {settlement && <details className="w-full min-w-0 text-subtle [overflow-wrap:anywhere]">
            <summary className="cursor-pointer">{t("agent-bus.settlement.evidence")}</summary>
            <p>{settlement.evidence.runtime} · {settlement.evidence.terminalStatus} · {settlement.evidence.observedAt}</p>
            <p>{settlement.evidence.threadId} · {settlement.evidence.actualTurnId}</p>
          </details>}
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-muted">
            {t("agent-bus.settlement.reason")}
            <input autoFocus className="min-w-0 rounded border border-border bg-surface px-2 py-1 text-foreground" maxLength={1024} value={write?.request?.reason ?? reason} disabled={busy || retry} onChange={(event) => setReason(event.target.value)} placeholder={t("agent-bus.settlement.reasonPlaceholder")} />
          </label>
          <button type="button" className={button} disabled={busy || record?.state === "delivered" || !settlement?.canClose || (!retry && (!reason.trim() || new TextEncoder().encode(reason.trim()).length > 1024)) || (retry && !write?.checked)} onClick={() => {
            if (!settlement) return;
            void closeMessageFollowUp(hostId, messageId, settlement, reason || write?.request?.reason || "", sessionId).then(() => onRefresh?.()).catch(() => {});
          }}>{t(busy ? "agent-bus.settlement.pending" : retry ? "agent-bus.settlement.retry" : "agent-bus.settlement.confirm")}</button>
          <button type="button" className={button} disabled={busy} onClick={() => { setOpen(false); if (!retry) setReason(""); }}>{t("settings.cancel")}</button>
          {write?.phase === "uncertain" && <>
            <p className="w-full text-warn-text" role="status">{t("agent-bus.settlement.uncertainWrite")}</p>
            <button type="button" className={button} disabled={busy} onClick={() => void recheckSettlement(hostId, messageId, sessionId).then(() => onRefresh?.()).catch(() => {})}>{t("agent-bus.settlement.recheck")}</button>
          </>}
          {write?.phase === "error" && <p className="w-full text-danger" role="alert">{t(`agent-bus.settlement.${write.error ?? "unknown"}`)}</p>}
        </div>
      )}
    </div>
  );
}
