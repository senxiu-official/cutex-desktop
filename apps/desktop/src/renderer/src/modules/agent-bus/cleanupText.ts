// Labels shared by the 待清理 tables (kept out of the .tsx files for Fast Refresh).
import type { StuckBusMessage } from "../../../../shared/ipc";
import type { MessageKey, useI18n } from "../../i18n";
import { ageParts, senderLabel } from "./stuck";

type T = ReturnType<typeof useI18n>["t"];

/** The action column's buttons: one size; idle faces (the armed face comes from ArmedButton). */
export const CLEANUP_ACTION = "rounded-md px-2 py-0.5 text-xs";
export const CLEANUP_ACTION_IDLE = "border border-border text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50";
export const CLEANUP_ACTION_DANGER = "border border-border text-muted hover:bg-surface-2 hover:text-danger disabled:opacity-50";

/** "12 分钟" / "3 天", or 时间未知. */
export function cleanupAge(secs: number | null, t: T): string {
  const age = ageParts(secs);
  return age ? t(`agent-bus.stuck.ago.${age.unit}` as MessageKey, { n: age.n }) : t("agent-bus.stuck.ageUnknown");
}

/** Who sent a stuck message: a session's name, or a system / owner sender by its kind. */
export function stuckFrom(m: Pick<StuckBusMessage, "from" | "senderKind">, t: T): string {
  const sender = senderLabel(m);
  return !sender ? t("agent-bus.stuck.unknownParty") : "name" in sender ? sender.name : t(`agent-bus.stuck.sender.${sender.kind}` as MessageKey);
}

export function stuckState(m: StuckBusMessage, t: T): string {
  if (m.settlement) return t(m.settlement.state === "closed" ? "agent-bus.settlement.closed" : "agent-bus.settlement.unknown");
  return (["pending", "stale_held", "live_only"] as const).includes(m.state as "pending") ? t(`agent-bus.stuck.state.${m.state}` as MessageKey) : m.state;
}
