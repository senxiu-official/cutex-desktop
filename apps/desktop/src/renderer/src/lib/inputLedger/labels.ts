// 054 §3.3: the session's delivery label (by `delivery`) and the stalled-minutes helper. A record's own status is no
// longer looked up here: every input row reads the Next Up registry (lib/inputLedger/nextUpRegistry, registry 1.5).

import type { InputRecord, SessionDelivery } from "@cutex-desktop/protocol";

/** Minutes of 「已等 N 分钟」. `noProgress` is about the whole wait: a host may rewrite its mark's `since`. */
export function stalledMinutes(record: InputRecord, now: number): number {
  if (!record.stalled) return 0;
  const since = record.stalled.reason === "noProgress" ? record.since : record.stalled.since;
  return Math.max(0, Math.floor((now - Date.parse(since)) / 60000));
}

/** Session header / 「工作中」 row ids (054 §3.3), read only from `delivery`. */
export const SESSION_DELIVERY_LABEL_IDS = [
  "offline", //            离线 · 发消息会自动启动
  "starting", //           正在启动
  "disconnected", //       连接断开 · 状态未知（不转圈，不计时）
  "idle", //               空闲
  "turn.owner", //         工作中
  "turn.ask", //           在做委托：<标题>
  "turn.delivery", //      正在读委托结果 / 留言
  "turn.unknown", //       工作中
  "finishing", //          正在收尾
  "held.hostBusy", //      主机正忙，消息稍后送达（倒计时 heldUntil）
  "held.paused", //        已暂停（「继续」）: paused / stopHold
  "held.delegationLease", // 委托占用中：<askId> · 已 N 分钟
  "held.eventLease", //    委托结果送达中 · 已 N 分钟
] as const;

export type SessionDeliveryLabelId = (typeof SESSION_DELIVERY_LABEL_IDS)[number];

export type SessionDeliveryLabel =
  | { kind: "label"; id: SessionDeliveryLabelId; leaseStale: boolean }
  | { kind: "unknown"; code: string; report: true; leaseStale: boolean };

export function sessionDeliveryLabel(delivery: SessionDelivery): SessionDeliveryLabel {
  const leaseStale = delivery.lease?.reconcile.state === "stale";
  const id = (value: string): SessionDeliveryLabel =>
    (SESSION_DELIVERY_LABEL_IDS as readonly string[]).includes(value)
      ? { kind: "label", id: value as SessionDeliveryLabelId, leaseStale }
      : { kind: "unknown", code: value, report: true, leaseStale };
  switch (delivery.state) {
    case "turn":
      return id(`turn.${delivery.turn?.kind ?? "unknown"}`);
    case "held": {
      const reason = delivery.reason === "stopHold" ? "paused" : delivery.reason;
      return reason ? id(`held.${reason}`) : { kind: "unknown", code: "held", report: true, leaseStale };
    }
    default:
      return id(delivery.state);
  }
}
