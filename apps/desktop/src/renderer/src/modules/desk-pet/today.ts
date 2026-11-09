// Today's tokens (pure, test/deskPetEnergy.test.ts): the number under the pet. Per connected host, what its usage ledger
// counted today when last asked, plus the reports seen live since that answer. The same rule as the live reports
// (lib/activityFeed countedTokens): input not read from a cache, plus output. Only cutex's own usage: rows the daemon
// imported from other tools (its extra usage sources) are left out. The day is this device's local day.
import type { UsageReport } from "../../../../shared/ipc";

/** Ask the ledger again after this long (also on every new connection, and when the day changes). */
export const CALIBRATE_EVERY_MS = 60 * 60 * 1000;

export interface HostToday {
  /** From the ledger (0 before its first answer, or from a cutex without one). */
  base: number;
  /** Live reports since the ledger's answer. */
  live: number;
  /** When the ledger answered; null = not yet. */
  at: number | null;
}

export interface Today {
  day: string;
  hosts: Readonly<Record<string, HostToday>>;
}

export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const freshToday = (day: string): Today => ({ day, hosts: {} });

/** The ledger's count for the report (`groupBy: ["source"]`): the `cutex` row; a cutex that cannot group by source has only its own rows. */
export function ledgerTokens(report: Pick<UsageReport, "rows" | "totals"> | null): number {
  if (!report) return 0;
  const sourced = report.rows.some((r) => r.key.source !== undefined);
  const amounts = sourced ? report.rows.find((r) => r.key.source === "cutex") : report.totals;
  if (!amounts) return 0;
  return Math.max(0, amounts.input - amounts.cachedInput) + amounts.output;
}

const hostOf = (today: Today, hostId: string): HostToday => today.hosts[hostId] ?? { base: 0, live: 0, at: null };

export function addLive(today: Today, hostId: string, tokens: number): Today {
  if (!(tokens > 0)) return today;
  const h = hostOf(today, hostId);
  return { ...today, hosts: { ...today.hosts, [hostId]: { ...h, live: h.live + tokens } } };
}

/** The ledger answered for `day`: its count replaces what was counted live before (an answer for another day is dropped). */
export function calibrated(today: Today, hostId: string, day: string, base: number, now: number): Today {
  if (day !== today.day) return today;
  return { ...today, hosts: { ...today.hosts, [hostId]: { base, live: 0, at: now } } };
}

/** The number: the connected hosts only. */
export function todayTotal(today: Today, connected: readonly string[]): number {
  let sum = 0;
  for (const id of connected) {
    const h = today.hosts[id];
    if (h) sum += h.base + h.live;
  }
  return sum;
}

/** Hosts whose ledger should be asked now. */
export function dueHosts(today: Today, connected: readonly string[], now: number): string[] {
  return connected.filter((id) => {
    const at = today.hosts[id]?.at;
    return at === null || at === undefined || now - at >= CALIBRATE_EVERY_MS;
  });
}

/** A new connection to the host: its ledger is due again (what was counted stays until it answers). */
export function reconnected(today: Today, hostId: string): Today {
  const h = today.hosts[hostId];
  return h ? { ...today, hosts: { ...today.hosts, [hostId]: { ...h, at: null } } } : today;
}
