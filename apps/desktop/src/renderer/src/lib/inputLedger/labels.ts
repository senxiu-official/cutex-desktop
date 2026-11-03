// 054 §3.3: the status label of a record and of the session, looked up only by
// (state, reason, stage, stalled) and by `delivery`. Data only: label ids, no UI strings — the UI blocks
// (D3 / D4) map ids to dictionary keys. An unknown reason is shown as its code and reported (050 invariant 4).

import type { InputRecord, InputState, SessionDelivery } from "@cutex-desktop/protocol";
import { INPUT_REASONS_BY_STATE, INPUT_STAGES } from "@cutex-desktop/protocol";

/**
 * Record label ids (054 §3.3). Comments give the meaning the UI string must carry.
 * Timeline (owner rows) and nextUp rows share ids where the meaning is the same.
 */
export const INPUT_LABEL_IDS = [
  "received", //          正在发送 (cutex has it, routing)
  "held", //              主机正忙，已收下，稍后送达
  "afterCurrentTurn", //  等当前回合结束后发出 (hover: the waiting reason)
  "agentOffline", //      等对方上线（后发出）
  "queued", //            排队中 (explicitQueue)
  "afterTurn", //         本回合结束后
  "nextStep", //          下一步
  "passive", //           待读取 (passive note; consumption timing is not guaranteed)
  "resultCoalescing", //  合并结果，倒计时
  "lease", //             等当前委托做完 (delegationLease / eventLease)
  "paused", //            已暂停 (paused / stopHold / ownerPause)
  "nativeHeld", //        对方暂时收不了：<details.nativeReason>
  "nativeRetry", //       对方出错，正在重试
  "staleHeld", //         积压超过 1 小时，等你放行
  "returned", //          没送进去，稍后重送
  "runtimeDisconnected", // 连接断开，等重连后发出
  "autoRetry", //         自动重试等待中
  "reviewPending", //     等审核
  "targetBusy", //        对方正忙
  "ownerRetry", //        重新发送，等待发出
  "sending", //           正在发送
  "inserted", //          accepted · Codex insert: 已插入，等下一步读到
  "registered", //        accepted · Claude registered: 已登记，等下一次工具调用
  "offered", //           accepted · Claude offered: 已送进工具间隙
  "accepted", //          accepted (not an insert: the turn carrying it took it)
  "inContext", //         no label (plain bubble)
  "uncertain", //         不确定是否送达 ·「重新发送」「算了」
  "failed", //            没发出去：<reason> ·「重试」
  "rejected", //          被拒绝：<reason>
  "discarded", //         已移除
  "superseded", //        已合并 / 已修改
] as const;

export type InputLabelId = (typeof INPUT_LABEL_IDS)[number];

export type InputLabel =
  | {
      kind: "label";
      id: InputLabelId;
      /** The reason code (hover text, `failed: <reason>` etc.). */
      reason: string | null;
      /** `stalled` adds 「已等 N 分钟 · 原因 …」 after the label. */
      stalled: InputRecord["stalled"];
    }
  | {
      /** Not in cutex's list for this state (newer cutex or a bug): show `code` as is and report it. */
      kind: "unknown";
      state: InputState | (string & {});
      code: string;
      field: "state" | "reason" | "stage";
      report: true;
      stalled: InputRecord["stalled"];
    };

const WAITING_LABELS: Record<string, InputLabelId> = {
  explicitQueue: "queued",
  afterTurn: "afterTurn",
  nextStep: "nextStep",
  passive: "passive",
  turnRunning: "afterCurrentTurn",
  turnFinishing: "afterCurrentTurn",
  adapterQueued: "afterCurrentTurn",
  ownerQueueAhead: "afterCurrentTurn",
  rideAlongAhead: "afterCurrentTurn",
  hostBusy: "afterCurrentTurn",
  delegationLease: "lease",
  eventLease: "lease",
  paused: "paused",
  stopHold: "paused",
  ownerPause: "paused",
  agentOffline: "agentOffline",
  runtimeDisconnected: "runtimeDisconnected",
  resultCoalescing: "resultCoalescing",
  autoRetry: "autoRetry",
  reviewPending: "reviewPending",
  targetBusy: "targetBusy",
  staleHeld: "staleHeld",
  nativeHeld: "nativeHeld",
  nativeRetry: "nativeRetry",
  returned: "returned",
  ownerRetry: "ownerRetry",
};

/** States whose label does not depend on the reason (the reason is shown next to it). */
const STATE_LABELS: Partial<Record<InputState, InputLabelId>> = {
  received: "received",
  held: "held",
  sending: "sending",
  inContext: "inContext",
  uncertain: "uncertain",
  failed: "failed",
  rejected: "rejected",
  discarded: "discarded",
  superseded: "superseded",
};

const ACCEPTED_LABELS: Record<string, InputLabelId> = { registered: "registered", offered: "offered" };

export interface InputLabelKey {
  state: InputState | (string & {});
  reason: string | null;
  stage: string | null;
  stalled: InputRecord["stalled"];
  /** accepted without a stage: an owner insert into a running turn (Codex) vs the input of the turn. */
  insert?: boolean;
}

/** The label for (state, reason, stage, stalled). */
export function inputLabelFor(key: InputLabelKey): InputLabel {
  const { state, reason, stage, stalled } = key;
  const unknown = (code: string, field: "state" | "reason" | "stage"): InputLabel => ({ kind: "unknown", state, code, field, report: true, stalled });
  const known = INPUT_REASONS_BY_STATE[state as InputState] as readonly string[] | undefined;
  if (reason !== null && (!known || !known.includes(reason))) return unknown(reason, "reason");
  if (state === "waiting") {
    if (reason === null) return unknown("", "reason");
    return { kind: "label", id: WAITING_LABELS[reason]!, reason, stalled };
  }
  if (state === "accepted") {
    if (stage !== null) {
      if (!(INPUT_STAGES as readonly string[]).includes(stage)) return unknown(stage, "stage");
      return { kind: "label", id: ACCEPTED_LABELS[stage]!, reason, stalled };
    }
    return { kind: "label", id: key.insert === false ? "accepted" : "inserted", reason, stalled };
  }
  const id = STATE_LABELS[state as InputState];
  if (!id) return unknown(state, "state");
  return { kind: "label", id, reason, stalled };
}

/** A record's label. An accepted owner record with a turn is an insert (Codex steer). */
export function inputLabel(record: InputRecord): InputLabel {
  const label = inputLabelFor({
    state: record.state,
    reason: record.reason,
    stage: record.stage,
    stalled: record.stalled,
    insert: record.kind === "owner",
  });
  // Older native-held records retain the server's waiting state/actions. This known
  // hold reason describes an unknown delivery outcome, not temporary unavailability.
  return label.kind === "label" && label.id === "nativeHeld" && record.details.nativeReason === "request_uncertain"
    ? { ...label, id: "uncertain" } : label;
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
