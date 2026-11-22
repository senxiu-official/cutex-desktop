// The quota popover's two insight lines (design 052 §5): a window's forecast (lib/quotaForecast) and
// 「谁在用」 — the top agents of a Claude account's window (lib/quotaAttribution, capability
// `quota-attribution`; every figure approximate, 约). Clicking an agent opens it.
import { useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import type { QuotaAttribution } from "../../../shared/quotaAttribution";
import { useI18n } from "../i18n";
import { shareText, summarizeAttribution, type AttributionLine } from "../lib/quotaAttribution";
import { forecastText, forecastTone, type QuotaForecast } from "../lib/quotaForecast";

const TONE = { danger: "text-danger", warn: "text-warn", muted: "text-subtle" } as const;

/** One window's forecast: 「约 01:40 用完」 (warn / danger) or 「撑得到重置」 / 「本周够用」 (quiet). */
export function ForecastLine({ forecast, id }: { forecast: QuotaForecast; id: string }) {
  const { t } = useI18n();
  const tone = forecastTone(forecast);
  return (
    <p data-quota-forecast={id} data-forecast-kind={forecast.kind} className={`col-span-4 -mt-0.5 text-caption/[inherit] ${TONE[tone]}`} data-tip={forecast.kind === "runsOut" || forecast.kind === "lasts" ? t("quota.forecast.rate", { rate: forecast.perHour < 1 ? forecast.perHour.toFixed(1) : String(Math.round(forecast.perHour)) }) : undefined}>
      {forecastText(forecast)}
    </p>
  );
}

/** Segment colours of the share bar: the accent fading by rank; 其它 muted; 未归因 hatched. */
const RANK_COLOR = ["var(--accent)", "color-mix(in oklab, var(--accent) 62%, transparent)", "color-mix(in oklab, var(--accent) 36%, transparent)"];
const OTHER_COLOR = "color-mix(in oklab, var(--fg-subtle) 80%, transparent)";
const UNATTRIBUTED_BG = "repeating-linear-gradient(135deg, color-mix(in oklab, var(--fg-subtle) 55%, transparent) 0 2px, transparent 2px 4px)";

/**
 * 「谁在用」 under a window: a stacked share bar, the top 3 agents (约 x %, a spinner while a turn runs),
 * 其它, 未归因 above the tolerance, and the full list on demand. `attribution` undefined = loading.
 */
export function WhoUses({ attribution, onOpenAgent }: { attribution: QuotaAttribution | null | undefined; onOpenAgent(sessionId: string): void }) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  if (attribution === undefined) {
    return (
      <div className="col-span-4 space-y-1" data-quota-who="loading" aria-busy>
        <span className="block text-caption/[inherit] text-subtle">{t("quota.who.title")}</span>
        <span className="block h-1 animate-skeleton rounded-full bg-surface-2" />
      </div>
    );
  }
  const summary = attribution ? summarizeAttribution(attribution) : null;
  if (!summary) return null;
  const lines: { key: string; color: string; bg?: string; share: number; line?: AttributionLine; label: string }[] = [
    ...(all ? summary.all : summary.top).map((line, i) => ({ key: line.row.cutexSessionId ?? `row-${i}`, color: RANK_COLOR[i] ?? OTHER_COLOR, share: line.share, line, label: line.row.sessionDeleted || !line.row.cutexSessionId ? t("quota.who.deleted") : (line.row.agentName ?? line.row.cutexSessionId) })),
    ...(!all && summary.other ? [{ key: "other", color: OTHER_COLOR, share: summary.other.share, label: t("quota.who.other", { n: summary.other.count }) }] : []),
    ...(summary.unattributed !== null ? [{ key: "unattributed", color: "transparent", bg: UNATTRIBUTED_BG, share: summary.unattributed, label: t("quota.who.unattributed") }] : []),
  ];
  const note = summary.calibrated ? (summary.lowConfidence ? t("quota.who.noteLow") : t("quota.who.note")) : t("quota.who.noteShares");
  return (
    <div className="col-span-4 space-y-1.5" data-quota-who="">
      <div className="flex items-baseline justify-between gap-3 text-caption/[inherit] text-subtle">
        <span>{summary.calibrated ? t("quota.who.title") : t("quota.who.titleShares")}</span>
        <span className="truncate" data-tip={[note, ...(attribution?.coverage?.warnings ?? [])].filter(Boolean).join("\n")}>{t("quota.who.approx")}</span>
      </div>
      {/* The window's used part split by who used it (shares of the recorded usage without a calibration). */}
      <div className="flex h-1 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
        {lines.map((l) => (
          <span key={l.key} className="h-full" style={{ width: `${Math.min(100, l.share)}%`, background: l.bg ?? l.color }} />
        ))}
      </div>
      <ul className="space-y-0.5">
        {lines.map((l) => {
          const id = l.line?.row.cutexSessionId;
          const clickable = !!id && !l.line?.row.sessionDeleted;
          return (
            <li key={l.key} className="text-xs">
              <button
                type="button"
                disabled={!clickable}
                data-quota-who-row={l.key}
                onClick={() => clickable && onOpenAgent(id)}
                data-tip={clickable ? t("quota.who.open", { name: l.label }) : undefined}
                className="-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-1.5 rounded px-1 py-0.5 text-left enabled:hover:bg-surface-2 disabled:cursor-default"
              >
                <span className="flex size-2 shrink-0 items-center justify-center rounded-full" style={{ background: l.bg ?? l.color, ...(l.bg ? { outline: "1px solid var(--border)" } : {}) }} aria-hidden />
                <span className={`min-w-0 flex-1 truncate ${l.line ? "" : "text-muted"}`}>{l.label}</span>
                {l.line?.row.running && <Loader2 size={11} className="shrink-0 animate-spin text-subtle" aria-label={t("quota.who.running")} />}
                <span className="shrink-0 text-subtle tabular-nums">{t("quota.who.share", { percent: shareText(l.share) })}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {summary.all.length > summary.top.length && (
        <button type="button" data-quota-who-all="" onClick={() => setAll((v) => !v)} className="flex items-center gap-0.5 text-caption/[inherit] text-subtle hover:text-foreground">
          {all ? t("quota.who.less") : t("quota.who.all", { n: summary.all.length })}
          <ChevronDown size={11} className={all ? "rotate-180" : ""} />
        </button>
      )}
    </div>
  );
}
