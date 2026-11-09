// The counters (pure): exact, kept apart from the rhythm, stored only on this device (module prefs).
import type { ActivityKind } from "../../lib/activityFeed";

export interface Counters {
  ownerMessage: number;
  command: number;
  tool: number;
}

export const ZERO: Counters = { ownerMessage: 0, command: 0, tool: 0 };

const count = (value: unknown): number => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0);

/** A stored value; anything malformed reads as 0. */
export function parseCounters(raw: unknown): Counters {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { ownerMessage: count(r.ownerMessage), command: count(r.command), tool: count(r.tool) };
}

export function addActivity(counters: Counters, kind: ActivityKind): Counters {
  return { ...counters, [kind]: counters[kind] + 1 };
}

export function totalOf(counters: Counters): number {
  return counters.ownerMessage + counters.command + counters.tool;
}
