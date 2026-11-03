// 待清理 → 已隐藏的回执: rows the owner (or the consumed-receipt rule) hid from 接下来 on this desktop,
// across the host's agents. Hiding is device-local display state (lib/busReceiptVisibility): 恢复显示
// brings a row back to its agent's 接下来; nothing is sent. Hosts with stale-ACK settlement also offer
// 全部在服务器关闭 (one reason, sequential, each refusal stays on its row) and, in a row's details, the
// per-message close — the server decides per message; nothing is resent. Moved here from 接下来's
// 「已隐藏 N 条」 list (owner 2026-10-30): hidden rows never show in the strip.
import { useRef, useState } from "react";
import type { AdmissionNextStep } from "@cutex-desktop/protocol";
import { messageSettlementAllowed, STALE_ACK_SETTLEMENT_FEATURE } from "../../../../shared/messageSettlement";
import { MessageSettlementControl } from "../../components/MessageSettlementControl";
import { EmptyState } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { useAgentMessages } from "../../lib/agentMessageStore";
import { restoreReceipt, type HiddenReceipt } from "../../lib/legacyDelivery/busReceiptVisibility";
import { useRestoreClosedReceipts } from "../../lib/legacyDelivery/hiddenReceiptClosure";
import { useHostAccess } from "../../lib/hostAccess";
import { closeHiddenMessageFollowUp, settlementWriteKey, useSettlementWrites } from "../../lib/messageSettlementWrites";
import { featuresOf, useApp, viewOf } from "../../store";
import { CleanupTable } from "./CleanupTable";
import { CLEANUP_ACTION, CLEANUP_ACTION_IDLE, cleanupAge } from "./cleanupText";
import { secondsSince } from "./cleanup";

const IDENTITY = (id: string) => id;

export function HiddenReceiptsTable({ hostId, rows, nameOf = IDENTITY }: { hostId: string; rows: readonly HiddenReceipt[]; nameOf?(id: string): string }) {
  const { t } = useI18n();
  const features = useApp((s) => featuresOf(s, hostId));
  const access = useHostAccess(hostId);
  const supported = !!features?.has?.(STALE_ACK_SETTLEMENT_FEATURE) && messageSettlementAllowed(features, access);
  const writes = useSettlementWrites((s) => s.entries);
  const messages = useAgentMessages((s) => s.byId);
  const activeHost = useApp((s) => s.hosts?.active);
  // Re-render when a session's 接下来 changes; its rows give the text of a hidden row this window has seen.
  useApp((s) => s.sessions);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useRestoreClosedReceipts(hostId, rows);
  const onHost = !activeHost || activeHost === hostId;
  const itemOf = (r: HiddenReceipt): AdmissionNextStep | undefined => {
    const state = useApp.getState();
    return state.sessions ? viewOf(state, hostId, r.session)?.admission?.nextStep?.find((item) => item.id === r.id) : undefined;
  };
  if (rows.length === 0) return <EmptyState>{t("agent-bus.cleanup.receipts.empty")}</EmptyState>;
  const button = `${CLEANUP_ACTION} ${CLEANUP_ACTION_IDLE} whitespace-nowrap`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-xs text-subtle">{t("queue.receipt.hideHint")}</p>
      {supported && (
        <div className="flex flex-wrap items-center gap-2 py-1 text-xs">
          {!confirm ? (
            <button type="button" className={button} disabled={busy} onClick={() => setConfirm(true)}>
              {t("queue.receipt.closeAll")}
            </button>
          ) : (
            <>
              <p className="w-full text-muted">{t("agent-bus.settlement.disclaimer")}</p>
              <label className="text-muted">
                {t("agent-bus.settlement.reason")}
                <input className="ml-2 rounded border border-border bg-surface px-2 py-1 text-foreground" value={reason} maxLength={1024} disabled={busy} onChange={(event) => setReason(event.target.value)} />
              </label>
              <button
                type="button"
                className={button}
                disabled={busy || !reason.trim() || new TextEncoder().encode(reason.trim()).length > 1024}
                onClick={() => {
                  if (lock.current) return;
                  lock.current = true;
                  setBusy(true);
                  const targets = [...rows];
                  // Sequential, bounded to the rows present at confirmation. Each refusal stays on its row.
                  void (async () => {
                    try {
                      for (const r of targets) await closeHiddenMessageFollowUp(hostId, r.id, r.session, reason);
                    } finally {
                      lock.current = false;
                      setBusy(false);
                    }
                  })().catch(() => {});
                }}
              >
                {t(busy ? "agent-bus.settlement.pending" : "agent-bus.settlement.confirm")}
              </button>
              <button type="button" className={button} disabled={busy} onClick={() => setConfirm(false)}>
                {t("settings.cancel")}
              </button>
            </>
          )}
        </div>
      )}
      <CleanupTable
        rows={rows}
        rowKey={(r) => JSON.stringify([r.session, r.id])}
        testId="hidden-receipt"
        actionWidth="5.75rem"
        foldPrefix="cleanup.receipts"
        cells={(r) => {
          const item = itemOf(r);
          const record = onHost ? messages[r.id] : undefined;
          const write = writes[settlementWriteKey(hostId, r.id)];
          const text = record?.body || item?.preview || item?.label || write?.preview || "";
          const from = record?.senderName ?? (record?.from ? nameOf(record.from) : null) ?? item?.from ?? t("agent-bus.stuck.unknownParty");
          const settlement = write?.settlement ?? record?.settlement;
          const sent = record?.sentAt ? Math.max(0, Math.floor(Date.now() / 1000 - record.sentAt)) : secondsSince(item?.enqueuedAt, Date.now());
          return {
            what: text || <span className="text-subtle">{r.id}</span>,
            whatTitle: text || r.id,
            who: `${from} → ${nameOf(r.session)}`,
            whoTitle: r.session,
            age: cleanupAge(sent, t),
            state: write?.error ? (
              <span className="text-warn-text">{t(`agent-bus.settlement.${write.error}`)}</span>
            ) : settlement?.state === "closed" ? (
              t("agent-bus.settlement.closed")
            ) : settlement?.canClose ? (
              t("agent-bus.cleanup.receipts.closable")
            ) : (
              t("agent-bus.cleanup.receipts.hidden")
            ),
            action: (
              <button type="button" className={button} disabled={busy || write?.phase === "pending"} onClick={() => restoreReceipt(hostId, r.session, r.id)}>
                {t("queue.receipt.restore")}
              </button>
            ),
          };
        }}
        details={(r) => {
          const item = itemOf(r);
          const record = onHost ? messages[r.id] : undefined;
          const write = writes[settlementWriteKey(hostId, r.id)];
          const text = record?.body || item?.preview || item?.label || write?.preview || "";
          return (
            <div className="flex min-w-0 flex-col gap-1.5">
              {text ? <p className="whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">{text}</p> : <p className="text-subtle">{t("agent-bus.cleanup.receipts.noText")}</p>}
              {record?.error && <p className="text-danger [overflow-wrap:anywhere]">{t("agent-bus.cleanup.lastError", { error: record.error })}</p>}
              {write?.error && <p role="status" className="text-warn-text">{t(`agent-bus.settlement.${write.error}`)}</p>}
              <p className="text-subtle [overflow-wrap:anywhere]">
                {nameOf(r.session)} · {r.session} · {r.id}
              </p>
              {supported && <MessageSettlementControl hostId={hostId} sessionId={r.session} messageId={r.id} settlement={write?.settlement} discover />}
            </div>
          );
        }}
      />
    </div>
  );
}
