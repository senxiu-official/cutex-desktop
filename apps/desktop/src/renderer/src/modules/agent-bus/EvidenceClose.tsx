// 「确认已结束并关闭」 on the cleanup page (state surfaces N8): the evidence-backed close of a stuck message's follow-up,
// shown beside 「结束跟进」 (MessageDetails). The same write as components/MessageSettlementControl
// (lib/messageSettlementWrites: one immutable request, an uncertain answer is re-read before an explicit retry with the
// same request) with the cleanup page's own label; Next Up rows keep MessageSettlementControl and its words.
import { useState } from "react";
import type { MessageSettlement } from "@cutex-desktop/protocol";
import { messageSettlementAllowed, mergeMessageSettlement, readMessageSettlement } from "../../../../shared/messageSettlement";
import { useI18n, type MessageKey } from "../../i18n";
import { useAgentMessage } from "../../lib/agentMessageStore";
import { useHostAccess } from "../../lib/hostAccess";
import { closeMessageFollowUp, recheckSettlement, settlementWriteKey, useSettlementWrites } from "../../lib/messageSettlementWrites";
import { featuresOf, useApp } from "../../store";
import { CLEANUP_ACTION, CLEANUP_ACTION_IDLE } from "./cleanupText";

const BUTTON = `${CLEANUP_ACTION} ${CLEANUP_ACTION_IDLE} whitespace-nowrap`;

export function EvidenceClose({ hostId, messageId, settlement: snapshot, sessionId, onRefresh }: { hostId: string; messageId: string; settlement?: MessageSettlement; sessionId?: string; onRefresh(): Promise<void> }) {
  const { t } = useI18n();
  const features = useApp((s) => featuresOf(s, hostId));
  const access = useHostAccess(hostId);
  const supported = messageSettlementAllowed(features, access);
  const rawRecord = useAgentMessage(messageId);
  const activeHost = useApp((s) => s.hosts?.active);
  const record = !activeHost || activeHost === hostId ? rawRecord : null;
  const write = useSettlementWrites((s) => s.entries[settlementWriteKey(hostId, messageId)]);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const validated = readMessageSettlement(snapshot);
  const cached = validated?.state === "closed" ? validated : record?.settlementKnown ? record.settlement : mergeMessageSettlement(validated, record?.settlement);
  const settlement = write?.authoritative ? mergeMessageSettlement(cached?.state === "closed" ? cached : undefined, write.settlement) : mergeMessageSettlement(cached, write?.settlement);
  const busy = write?.phase === "pending";
  if (settlement?.state === "closed")
    return (
      <span className="min-w-0 text-xs text-subtle [overflow-wrap:anywhere]" data-testid="message-settlement-closed" title={t("agent-bus.settlement.disclaimer")}>
        {t("agent-bus.settlement.closed")}
        {settlement.closure && <span className="ml-1">· {settlement.closure.reason}</span>}
      </span>
    );
  // Never offer a close on a delivered item; an uncertain write keeps its recovery.
  if (!supported || (record?.state === "delivered" && !write?.request)) return null;
  if (!settlement?.canClose && !write?.request) return null;
  const retry = !!write?.request;
  if (!open)
    return (
      <button type="button" className={BUTTON} disabled={busy} data-testid="stuck-evidence-close" title={t("agent-bus.settlement.disclaimer")} onClick={() => setOpen(true)}>
        {t(settlement?.canClose ? "agent-bus.settlement.closeConfirmed" : "agent-bus.settlement.recheck")}
      </button>
    );
  const tooLong = new TextEncoder().encode(reason.trim()).length > 1024;
  return (
    <div className="my-1 flex w-full min-w-0 flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 p-2 text-xs" aria-busy={busy} data-testid="stuck-evidence-close-form" onClick={(e) => e.stopPropagation()}>
      <p className="w-full text-muted">{t("agent-bus.settlement.disclaimer")}</p>
      {settlement && (
        <details className="w-full min-w-0 text-subtle [overflow-wrap:anywhere]">
          <summary className="cursor-pointer">{t("agent-bus.settlement.evidence")}</summary>
          <p>{settlement.evidence.runtime} · {settlement.evidence.terminalStatus} · {settlement.evidence.observedAt}</p>
          <p>{settlement.evidence.threadId} · {settlement.evidence.actualTurnId === "unassigned" ? t("agent-bus.settlement.unassignedTurn") : settlement.evidence.actualTurnId}</p>
        </details>
      )}
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-muted">
        {t("agent-bus.settlement.reason")}
        <input autoFocus className="min-w-0 rounded border border-border bg-surface px-2 py-1 text-foreground" maxLength={1024} value={write?.request?.reason ?? reason} disabled={busy || retry} onChange={(e) => setReason(e.target.value)} placeholder={t("agent-bus.settlement.reasonPlaceholder")} />
      </label>
      <button
        type="button"
        className={BUTTON}
        disabled={busy || record?.state === "delivered" || !settlement?.canClose || (!retry && (!reason.trim() || tooLong)) || (retry && !write?.checked)}
        onClick={() => {
          if (!settlement) return;
          void closeMessageFollowUp(hostId, messageId, settlement, reason || write?.request?.reason || "", sessionId)
            .then(() => onRefresh())
            .catch(() => {});
        }}
      >
        {t(busy ? "agent-bus.settlement.pending" : retry ? "agent-bus.settlement.retry" : "agent-bus.settlement.confirm")}
      </button>
      <button type="button" className={BUTTON} disabled={busy} onClick={() => { setOpen(false); if (!retry) setReason(""); }}>
        {t("settings.cancel")}
      </button>
      {write?.phase === "uncertain" && (
        <>
          <p className="w-full text-warn-text" role="status">{t("agent-bus.settlement.uncertainWrite")}</p>
          <button type="button" className={BUTTON} disabled={busy} onClick={() => void recheckSettlement(hostId, messageId, sessionId).then(() => onRefresh()).catch(() => {})}>
            {t("agent-bus.settlement.recheck")}
          </button>
        </>
      )}
      {write?.phase === "error" && <p className="w-full text-danger" role="alert">{t(`agent-bus.settlement.${write.error ?? "unknown"}` as MessageKey)}</p>}
    </div>
  );
}
