// 停止 holds everything (cutex `stop-holds-ridealongs`, docs user-input-delivery §3, owner decision
// 2026-10-12): after `cutex/turn/stop` everything that waits for the agent — ride-alongs (answers,
// questions, wakes, tells, alarms) and new delegations — stays held until 继续发送 (queue resume),
// `cutex/asks/resume` or the owner's next message that starts / steers a turn (a message that is
// only queued releases nothing). Snapshot: `admission.ridealongsHeld` / `nextStep[].held`,
// `asksPaused.origin: "ownerStop"` + `stopHold`. An explicit 暂停委托 holds ask results
// (`held: "ownerPause"`). A closed runtime gate (`origin: "runtimeGate"`, cutex runtime-gate-pause) reads
// 「已暂停：上一轮被中断，工具效果不确定 · 恢复」. Older cutex: none of these fields, nothing changes.
// Pure (no React, no store) so it is unit-tested.
import type { AdmissionHeld, AdmissionNextStep, AsksPause, QueueAdmission } from "@cutex-desktop/protocol";
import type { MessageKey } from "../i18n";

export const STOP_HOLD_FEATURE = "stop-holds-ridealongs";

/** Whether an owner stop hold is on (queue resume / 继续发送 releases it). */
export function stopHeld(pause: AsksPause | null | undefined): boolean {
  return !!pause && (pause.stopHold === true || pause.origin === "ownerStop");
}

/**
 * How a delegation pause reads: `stop` = 已随停止暂停 (only the stop holds it; 继续发送 releases it),
 * `owner` = an explicit 暂停委托 (继续委托; a stop on top of it is released together), `gate` = the
 * runtime closed its input gate after an interrupted / failed turn (cutex `runtime-gate-pause`; 恢复 =
 * asks resume, which reopens it; the owner's next message reopens it too), null = none.
 */
export function asksPauseKind(pause: AsksPause | null | undefined): "stop" | "owner" | "gate" | null {
  if (!pause) return null;
  if (pause.origin === "runtimeGate") return "gate";
  return pause.origin === "ownerStop" ? "stop" : "owner";
}

/** Why ride-along `item` is held (undefined = it is not): its own `held`, else the snapshot-wide stop hold. */
export function rideAlongHeld(item: AdmissionNextStep, admission: Pick<QueueAdmission, "ridealongsHeld"> | null | undefined): AdmissionHeld | undefined {
  if (item.held === "ownerStop" || item.held === "ownerPause") return item.held;
  return admission?.ridealongsHeld === "ownerStop" ? "ownerStop" : undefined;
}

/** Ride-along groups: the free ones (timing as usual), then the held ones by reason (stop first). */
export function splitHeld(items: readonly AdmissionNextStep[], admission: Pick<QueueAdmission, "ridealongsHeld"> | null | undefined): { free: AdmissionNextStep[]; held: { reason: AdmissionHeld; items: AdmissionNextStep[] }[] } {
  const free: AdmissionNextStep[] = [];
  const stop: AdmissionNextStep[] = [];
  const pause: AdmissionNextStep[] = [];
  for (const item of items) {
    const h = rideAlongHeld(item, admission);
    (h === "ownerStop" ? stop : h === "ownerPause" ? pause : free).push(item);
  }
  const held: { reason: AdmissionHeld; items: AdmissionNextStep[] }[] = [];
  if (stop.length) held.push({ reason: "ownerStop", items: stop });
  if (pause.length) held.push({ reason: "ownerPause", items: pause });
  return { free, held };
}

/** The words of a held group / row: strip (short), tooltip (what releases it). */
export function heldKeys(reason: AdmissionHeld): { strip: MessageKey; hint: MessageKey } {
  return reason === "ownerStop" ? { strip: "queue.turn.heldStop", hint: "queue.turn.heldStopHint" } : { strip: "queue.turn.heldPause", hint: "queue.turn.heldPauseHint" };
}

/** The asks-paused section's words and its resume button (继续发送 for a stop hold, 继续 for 暂停委托). */
export function asksPausedKeys(pause: AsksPause): { title: MessageKey; hint: MessageKey; button: MessageKey; buttonHint: MessageKey; resume: "queue" | "asks" } {
  if (asksPauseKind(pause) === "gate") return { title: "asksPause.gateTitle", hint: "asksPause.gateTitleHint", button: "asksPause.gateResume", buttonHint: "asksPause.gateResumeHint", resume: "asks" };
  if (asksPauseKind(pause) === "stop") return { title: "asksPause.stopTitle", hint: "asksPause.stopTitleHint", button: "paused.resume", buttonHint: "paused.resumeHintStop", resume: "queue" };
  return { title: "asksPause.title", hint: pause.stopHold ? "asksPause.titleHintStop" : "asksPause.titleHint", button: "asksPause.resumeShort", buttonHint: "asksPause.resumeHint", resume: "asks" };
}
