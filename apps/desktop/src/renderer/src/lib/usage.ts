// Pure helpers for cutex `GET /v2/usage` reports (Settings → 用量, modules/usage).
import type { UsageReport } from "../../../shared/ipc";

/** 1234 → "1.2k", 3_400_000 → "3.4M". */
export function formatTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

/** Local calendar day "YYYY-MM-DD" (the ledger uses the daemon host's local days). */
export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Series label for a row under a split dimension. */
export function seriesName(key: UsageReport["rows"][number]["key"], split: string): string {
  const k = key as Record<string, string | null | undefined>;
  // source: an extra usage source shows its label; cutex's own rows read "cutex".
  if (split === "source") return k.sourceLabel ?? k.source ?? "—";
  return (split === "agent" ? k.agentName : split === "project" ? k.projectName : k[split]) ?? "—";
}

