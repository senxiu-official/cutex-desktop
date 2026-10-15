// Pure helpers for 额外目录 (cutex usage-external-sources, shared/usageSources.ts).
import type { UsageReport } from "../../../../shared/ipc";
import { USAGE_SOURCE_KINDS, type UsageSourceKind, type UsageSourcesView } from "../../../../shared/usageSources";
import { seriesName } from "../../lib/usage";

/** Kinds a new source may have: the ones both this build and the host know (claude-code / codex before the host listed `kinds`; `zcode` only when advertised). */
export function availableKinds(view: UsageSourcesView | null): UsageSourceKind[] {
  const host = view?.kinds;
  if (!Array.isArray(host) || host.length === 0) return ["claude-code", "codex"];
  return USAGE_SOURCE_KINDS.filter((k) => host.includes(k));
}

/** Directory offered for a new source of this kind: the host's default (`~/.claude` / `~/.codex` / `~/.zcode`) when it exists and no source uses it yet. */
export function suggestedPath(view: UsageSourcesView | null, kind: UsageSourceKind): string {
  const d = view?.defaults.find((x) => x.kind === kind);
  if (!d?.path || !d.exists) return "";
  return view!.sources.some((s) => s.path === d.path) ? "" : d.path;
}

/** Source split: series name → billing of the extra source it stands for (cutex's own rows: none). */
export function billingBySeries(report: UsageReport): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of report.rows) {
    if (r.key.source && r.key.source !== "cutex" && r.key.sourceBilling) out.set(seriesName(r.key, "source"), r.key.sourceBilling);
  }
  return out;
}

/** Any source still scanning (the card polls until none is). */
export function anyScanning(view: UsageSourcesView | null): boolean {
  return !!view?.sources.some((s) => s.enabled && s.status.scanning);
}

/** Local "MM-DD HH:mm" of a scan time. */
export function scanClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
