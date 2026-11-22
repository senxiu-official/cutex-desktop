// 「查看这条消息」 of a queued alarm (state surfaces W5): an alarm that went off is only handed to the message queue
// (Agent Bus); its delivery is an input of the target agent whose input id is the alarm's id (`alarm-<uuid>`, the
// delivery message id). The link opens the target agent and goes to that input: the turn that read it when it has
// one (services.timeline.focusTurn), else its row in 接下来 / the timeline placeholder (`[data-input-id]`).
// Hosts without the input ledger have no such record: the agent opens and a notice says the message wasn't found.
import type { AlarmView } from "../../../../shared/alarms";
import { flashElement } from "../../lib/focusRequest";
import { openHostAgent } from "../../lib/hostLists";
import { ownerDocumentOf } from "../../lib/ownerWindow";
import { viewKey } from "../../lib/viewKey";
import { useApp } from "../../store";
import { services } from "../app";
import { alarmMessageTarget } from "./model";

const WAIT_MS = 5_000;
const STEP_MS = 150;

async function until<T>(read: () => T | null | undefined, ms: number): Promise<T | null> {
  for (let left = ms; ; left -= STEP_MS) {
    const v = read();
    if (v) return v;
    if (left <= 0) return null;
    await new Promise((r) => setTimeout(r, STEP_MS));
  }
}

/** Open the alarm's target agent and go to the alarm's message; `notFound` is said when it can't be located. */
export async function openAlarmMessage(hostId: string, alarm: Pick<AlarmView, "id" | "targetCutexSessionId">, notFound: string): Promise<void> {
  const sessionId = alarm.targetCutexSessionId;
  openHostAgent(hostId, sessionId);
  const key = viewKey(hostId, sessionId);
  // The ledger is read once the agent's view opens; a record that never shows up leaves `none`.
  const record = await until(() => useApp.getState().inputs[key]?.records.get(alarm.id), WAIT_MS);
  const target = alarmMessageTarget(record ?? undefined);
  if (target.kind === "turn") {
    const r = await services.timeline.focusTurn(hostId, sessionId, target.turnId, { back: true });
    if (r.status === "focused") return;
  }
  const el = await until(() => ownerDocumentOf(null).querySelector(`[data-input-id="${CSS.escape(alarm.id)}"]`), target.kind === "none" ? STEP_MS : WAIT_MS);
  if (el) return flashElement(el);
  services.ui.notice(notFound, "info");
}
