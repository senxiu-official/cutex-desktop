// Senders that are cutex itself, not an agent: the delegation service (`cutex-asks`) shows as
// 委托系统 / Delegation System, alarms (`Cutex Alarm`) as 闹钟 / Alarm, the Job Service
// (`cutex-job-service`) as 作业 / Job, every other cutex service (task service, agent management,
// owner-notify system notices …) as Cutex 系统 / Cutex System, all with the square
// logo (components/SystemAvatar). Agent session ids are `cutex.<id>` (dot), so the `cutex-` (dash)
// service ids never collide with them.
import type { MessageKey } from "../i18n";

export type SystemSender = "delegation" | "alarm" | "job" | "cutex";

/** Service ids with a sender name of their own (cutex src: agent_bus/alarms.rs, job service). */
const NAMED_SERVICES: Readonly<Record<string, SystemSender>> = {
  "cutex-asks": "delegation",
  "Cutex Alarm": "alarm",
  "cutex-job-service": "job",
};

/** Service ids cutex uses that do not follow the `cutex-…` pattern (cutex src: alarms.rs, agent_management). */
const CUTEX_SERVICE_IDS = new Set(["Cutex Alarm", "AgentManagementSystem"]);

/**
 * Which system sender an external input / bus message came from, or null for an agent (or the
 * owner). `sourceKind` is the event body's `source.kind` when known ("service" = cutex).
 */
export function systemSender(id: string | null | undefined, sourceKind?: string | null): SystemSender | null {
  const named = id ? NAMED_SERVICES[id] : undefined;
  if (named) return named;
  if (sourceKind === "service") return "cutex";
  if (!id) return null;
  if (CUTEX_SERVICE_IDS.has(id) || /^cutex-[a-z0-9-]+$/.test(id)) return "cutex";
  return null;
}

export const SYSTEM_SENDER_NAME: Record<SystemSender, MessageKey> = {
  delegation: "system.delegation",
  alarm: "system.alarm",
  job: "system.job",
  cutex: "system.cutex",
};

/** The name to show for a sender: the system sender's name, else the given name. */
export function senderLabel(t: (key: MessageKey) => string, id: string | null | undefined, sourceKind: string | null | undefined, name: string): string {
  const system = systemSender(id, sourceKind);
  return system ? t(SYSTEM_SENDER_NAME[system]) : name;
}
