import { useEffect, useState } from "react";
import type { SessionDelivery } from "@cutex-desktop/protocol";
import { sessionDeliveryLabel } from "../lib/inputLedger/labels";
import { useI18n, type MessageKey } from "../i18n";
import { useApp } from "../store";
import { bridge } from "../bridge";
import { useNow } from "../lib/time";

export function DeliveryStatus({ delivery, sessionId, hostId, askTitle, leaseRecovery = true }: { delivery: SessionDelivery; sessionId: string; hostId?: string; askTitle?: string; leaseRecovery?: boolean }) {
  const { t } = useI18n();
  const label = sessionDeliveryLabel(delivery);
  const [pending, setPending] = useState(false);
  const [armed, setArmed] = useState(false);
  const unknown = label.kind === "unknown" ? label.code : null;
  const disconnected = delivery.state === "disconnected";
  const heldUntil = delivery.state === "held" && delivery.reason === "hostBusy" ? Date.parse(delivery.heldUntil ?? "") : NaN;
  const leaseSince = !disconnected && delivery.lease ? Date.parse(delivery.lease.since) : NaN;
  const now = useNow(Number.isFinite(heldUntil) || Number.isFinite(leaseSince));
  const paused = delivery.state === "held" && (delivery.reason === "paused" || delivery.reason === "stopHold");
  const resume = async () => {
    setPending(true);
    try { await useApp.getState().resumePaused(sessionId, hostId); }
    catch (error) { useApp.getState().notify(String(error), "error", { hostId: hostId ?? "local", sessionId }); }
    finally { setPending(false); }
  };
  useEffect(() => { if (unknown) bridge.shell?.logError({ kind: "reported", message: `input-ledger unknown delivery ${unknown}` }); }, [unknown]);
  useEffect(() => { setArmed(false); }, [delivery.lease]);
  const release = async () => {
    if (!armed) { setArmed(true); return; }
    setPending(true);
    try { await useApp.getState().releaseInputLease(sessionId, hostId); }
    catch (error) { useApp.getState().notify(String(error), "error", { hostId: hostId ?? "local", sessionId }); }
    finally { setPending(false); setArmed(false); }
  };
  // A turn a result / note started is just 「工作中」 (owner 2026-11-19: 「正在读委托结果或留言 · 已占用 N 分钟」 misled):
  // where it came from and how long it has run are the detail (hover), not the label.
  const fromDelivery = label.kind === "label" && label.id === "turn.delivery";
  const leaseMinutes = Number.isFinite(leaseSince) ? Math.max(0, Math.floor((now - leaseSince) / 60000)) : null;
  const tip = fromDelivery
    ? [t("noteDelivery.turnFrom.delivery"), leaseMinutes !== null ? t("noteDelivery.turnFor", { n: leaseMinutes }) : null, label.leaseStale ? t("inputLedger.leaseStale") : null].filter(Boolean).join(" · ")
    : delivery.lease ? label.leaseStale ? t("inputLedger.leaseStale") : label.kind === "label" ? t(`inputLedger.delivery.${label.id}` as MessageKey) : t("inputLedger.unknown") : undefined;
  return <span className="inline-flex min-h-5 min-w-0 items-center gap-1 text-caption text-subtle" data-testid="delivery-status" data-state={delivery.state} data-turn-from={fromDelivery ? "delivery" : undefined} data-tip={tip}>
    <span className="truncate">{label.kind === "unknown" ? label.code : t(`inputLedger.delivery.${fromDelivery ? "turn.owner" : label.id}` as MessageKey)}</span>
    {delivery.state === "turn" && delivery.turn?.kind === "ask" && askTitle && <span className="truncate" data-testid="delivery-ask">{askTitle}</span>}
    {/* heldUntil is cutex's give-up deadline for a hostBusy hold (owner_held HELD_BUDGET): the message goes out in the mode
        the owner chose as soon as the host is free, or fails visibly (admission_timeout) at the deadline. Never 「插话」
        (queue.meta.countdown is the ride-along wait-insert countdown; owner 2026-11-28 read it as a mode change). */}
    {Number.isFinite(heldUntil) && <span className="shrink-0 tabular-nums" data-testid="delivery-countdown" data-tip={t("inputLedger.delivery.held.deadlineHint")}>· {t("inputLedger.delivery.held.deadline", { n: Math.max(0, Math.ceil((heldUntil - now) / 1000)) })}</span>}
    {leaseMinutes !== null && !fromDelivery && <span className="shrink-0 tabular-nums" data-testid="delivery-lease-elapsed">{t("inputLedger.leaseElapsed", { n: leaseMinutes })}</span>}
    {paused && <button type="button" className="h-5 shrink-0 rounded px-1 hover:bg-surface-2" disabled={pending} onClick={() => void resume()}>{t("paused.resume")}</button>}
    {label.leaseStale && leaseRecovery && <><span className="text-warn-text">{t("inputLedger.leaseStale")}</span><button type="button" disabled={pending} className={`h-5 shrink-0 rounded px-1 ${armed ? "bg-danger/10 text-danger-text" : "hover:bg-surface-2"}`} onBlur={() => setArmed(false)} onClick={() => void release()} data-tip={t("inputLedger.releaseHint")}>{t(armed ? "inputLedger.releaseAgain" : "inputLedger.release")}</button></>}
  </span>;
}
