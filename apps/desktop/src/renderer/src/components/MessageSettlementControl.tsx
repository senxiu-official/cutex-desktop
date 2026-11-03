import { useState, type ReactNode } from "react";
import { Ellipsis, Info } from "lucide-react";
import type { MessageSettlement } from "@cutex-desktop/protocol";
import { messageSettlementAllowed, mergeMessageSettlement, readMessageSettlement, STALE_ACK_SETTLEMENT_FEATURE } from "../../../shared/messageSettlement";
import { useI18n } from "../i18n";
import { featuresOf, useApp } from "../store";
import { useAgentMessage } from "../lib/agentMessageStore";
import { useHostAccess } from "../lib/hostAccess";
import { closeMessageFollowUp, discoverMessageSettlement, recheckSettlement, settlementWriteKey, useSettlementWrites } from "../lib/messageSettlementWrites";
import { Popover } from "./Menu";

/** Kept outside the row's main button, with an optional compact queue menu. */
interface SettlementControlProps {
  hostId: string;
  messageId: string;
  settlement?: MessageSettlement;
  sessionId?: string;
  onRefresh?: () => Promise<void>;
  discover?: boolean;
  /** Queue rows share one menu; settings keep the inline confirmation. */
  compact?: boolean;
  actions?: ReactNode;
  retainActions?: boolean;
}

export function MessageSettlementControl(props: SettlementControlProps) {
  const rawRecord = useAgentMessage(props.messageId);
  const activeHost = useApp(s => s.hosts?.active);
  const record = !activeHost || activeHost === props.hostId ? rawRecord : null;
  const write = useSettlementWrites((s) => s.entries[settlementWriteKey(props.hostId, props.messageId)]);
  const features = useApp(s => featuresOf(s, props.hostId));
  const discovery = !!props.discover && features?.has?.(STALE_ACK_SETTLEMENT_FEATURE);
  if (!props.settlement && !record?.settlement && !write?.request && !discovery && !props.actions) return null;
  return <SettlementControl key={settlementWriteKey(props.hostId, props.messageId)} {...props} />;
}

function SettlementControl({ hostId, messageId, settlement: snapshot, sessionId, onRefresh, discover, compact, actions, retainActions }: SettlementControlProps) {
  const { t } = useI18n();
  const features = useApp((s) => featuresOf(s, hostId));
  const access = useHostAccess(hostId);
  const supported = messageSettlementAllowed(features, access);
  const rawRecord = useAgentMessage(messageId);
  const activeHost = useApp(s => s.hosts?.active);
  const record = !activeHost || activeHost === hostId ? rawRecord : null;
  const write = useSettlementWrites((s) => s.entries[settlementWriteKey(hostId, messageId)]);
  const validated = readMessageSettlement(snapshot);
  const cached = validated?.state === "closed" ? validated : record?.settlementKnown ? record.settlement : mergeMessageSettlement(validated, record?.settlement);
  const settlement = write?.authoritative
    ? mergeMessageSettlement(cached?.state === "closed" ? cached : undefined, write.settlement)
    : mergeMessageSettlement(cached, write?.settlement);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const busy = write?.phase === "pending";
  const menuItem = "flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50";
  const button = compact && !open ? menuItem : "shrink-0 rounded-md border border-border px-2 py-0.5 text-xs text-muted hover:text-foreground disabled:opacity-50";
  const status = settlement?.state === "closed" ? t("agent-bus.settlement.closed")
    : busy ? t("agent-bus.settlement.pending")
    : write?.phase === "uncertain" ? t("agent-bus.settlement.uncertainWrite")
    : write?.error ? t(write.error === "ineligible" ? "agent-bus.settlement.ineligibleStatus" : "agent-bus.settlement.readFailed") : undefined;
  const present = (content: ReactNode) => {
    if (!compact) return content;
    if (!content && !actions) return null;
    return <div className="flex shrink-0 items-center gap-1 text-xs" data-testid="next-step-actions" onClick={event => event.stopPropagation()}>
      {status && <span tabIndex={0} role="img" aria-label={status} title={status} className="rounded text-subtle focus-visible:outline focus-visible:outline-accent" data-testid="next-step-status"><Info size={12} /></span>}
      <Popover align="right" width="w-80" focusContent keepMounted={retainActions} trigger={<Ellipsis size={15} />} triggerLabel={t("menu.more")} triggerTitle={t("menu.more")}
        triggerClassName="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-foreground focus-visible:outline focus-visible:outline-accent">
        {() => <div className="min-w-0 text-xs" role="group" aria-label={t("menu.more")}>
          {actions}
          {content}
        </div>}
      </Popover>
    </div>;
  };
  if (settlement?.state === "closed") return present(
    <div className="min-w-0 text-xs text-subtle [overflow-wrap:anywhere]" data-testid="message-settlement-closed">
      <span title={t("agent-bus.settlement.disclaimer")}>{t("agent-bus.settlement.closed")}</span>
      {settlement.closure && <span className="ml-1" title={`${settlement.closure.actor} · ${settlement.closure.closedAt}`}>· {settlement.closure.reason}</span>}
    </div>
  );
  // Retain recovery for an uncertain write, but never offer another close on a delivered item.
  if (!supported || (record?.state === "delivered" && !write?.request)) return present(null);
  const discovery = discover && sessionId && features.has(STALE_ACK_SETTLEMENT_FEATURE);
  if (!settlement?.canClose && !write?.request && compact) return present(discovery ? <div data-testid="message-settlement-discovery">
    {write?.error && <div aria-disabled="true" className="px-2.5 py-1.5 text-subtle [overflow-wrap:anywhere]" title={t(`agent-bus.settlement.${write.error}`)}>{status}<p className="mt-1">{t(`agent-bus.settlement.${write.error}`)}</p></div>}
    <button type="button" className={menuItem} disabled={busy} onClick={() => { void discoverMessageSettlement(hostId, messageId, sessionId).catch(() => {}); }}>{t(busy ? "agent-bus.settlement.pending" : "agent-bus.settlement.recheck")}</button>
  </div> : null);
  if (!settlement?.canClose && !write?.request) return discovery ? (
    <div className="min-w-0 max-w-[45%] shrink-0 self-center text-caption font-normal text-subtle" data-testid="message-settlement-discovery" onClick={event => event.stopPropagation()}>
      {write?.error ? <Popover
        align="right"
        width="w-72"
        trigger={<span role="status">{t(busy ? "agent-bus.settlement.pending" : write.error === "ineligible" ? "agent-bus.settlement.ineligibleStatus" : "agent-bus.settlement.readFailed")}</span>}
        triggerTitle={t(`agent-bus.settlement.${write.error}`)}
        triggerClassName="block max-w-full truncate rounded px-1 py-0.5 text-caption font-normal text-subtle hover:bg-surface-2 hover:text-foreground focus-visible:outline focus-visible:outline-accent"
      >{() => <div className="space-y-2 p-2 text-xs font-normal">
        <p className="whitespace-normal text-muted [overflow-wrap:anywhere]">{t(`agent-bus.settlement.${write.error ?? "unknown"}`)}</p>
        <button type="button" className={button} disabled={busy} onClick={() => {
          void discoverMessageSettlement(hostId, messageId, sessionId).catch(() => {});
        }}>{t(busy ? "agent-bus.settlement.pending" : "agent-bus.settlement.recheck")}</button>
      </div>}</Popover> : <button type="button" className={`${button} max-w-full truncate`} disabled={busy} onClick={event => {
        event.stopPropagation(); void discoverMessageSettlement(hostId, messageId, sessionId).catch(() => {});
      }}>{t(busy ? "agent-bus.settlement.pending" : "agent-bus.settlement.recheck")}</button>}
    </div>
  ) : null;
  const retry = !!write?.request;
  return present(
    <div className={`${open ? "w-full" : "shrink-0"} min-w-0 text-xs`} data-testid="message-settlement-control" onClick={(event) => event.stopPropagation()}>
      {!open ? <button type="button" className={button} disabled={busy} onClick={() => setOpen(true)}>{t(settlement?.canClose ? "agent-bus.settlement.close" : "agent-bus.settlement.recheck")}</button> : (
        <div className="my-1 flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 p-2" aria-busy={busy}>
          <p className="w-full text-muted">{t("agent-bus.settlement.disclaimer")}</p>
          {settlement && <details className="w-full min-w-0 text-subtle [overflow-wrap:anywhere]">
            <summary className="cursor-pointer">{t("agent-bus.settlement.evidence")}</summary>
            <p>{settlement.evidence.runtime} · {settlement.evidence.terminalStatus} · {settlement.evidence.observedAt}</p>
            <p>{settlement.evidence.threadId} · {settlement.evidence.actualTurnId === "unassigned" ? t("agent-bus.settlement.unassignedTurn") : settlement.evidence.actualTurnId}</p>
            {settlement.evidence.staleAck?.laterCompletedTurnId && <p>{t("agent-bus.settlement.laterCompletedTurn")} · {settlement.evidence.staleAck.laterCompletedTurnId}</p>}
          </details>}
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-muted">
            {t("agent-bus.settlement.reason")}
            <input autoFocus className="min-w-0 rounded border border-border bg-surface px-2 py-1 text-foreground" maxLength={1024} value={write?.request?.reason ?? reason} disabled={busy || retry} onChange={(event) => setReason(event.target.value)} placeholder={t("agent-bus.settlement.reasonPlaceholder")} />
          </label>
          <button type="button" className={button} disabled={busy || record?.state === "delivered" || !settlement?.canClose || (!retry && (!reason.trim() || new TextEncoder().encode(reason.trim()).length > 1024)) || (retry && !write?.checked)} onClick={() => {
            if (!settlement) return;
            void (async () => {
              let fresh = settlement;
              if (discovery) {
                await discoverMessageSettlement(hostId, messageId, sessionId);
                const entry = useSettlementWrites.getState().entries[settlementWriteKey(hostId, messageId)];
                if (!entry?.settlement?.canClose || entry.phase === "pending") return;
                fresh = entry.settlement;
              }
              await closeMessageFollowUp(hostId, messageId, fresh, reason || write?.request?.reason || "", sessionId);
              await onRefresh?.();
            })().catch(() => {});
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
