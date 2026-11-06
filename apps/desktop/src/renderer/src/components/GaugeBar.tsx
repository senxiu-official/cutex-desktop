// One quota bar used everywhere a percentage quota is shown (composer popover, profile page,
// Settings → 用量): used vs limit, colour shifting to warn / danger near the limit.
import { useI18n } from "../i18n";
import { useClock } from "../lib/time";
import { fillColor, formatBalance, gaugeLabel, quotaEvenPaceRemaining, resetsIn, usedRatio, type QuotaGauge, type QuotaView } from "../lib/quota";

/** `view="remaining"`: the bar fills with what is left and warms as it runs out (lib/quota fillColor). */
export function GaugeBar({ ratio, className = "h-1.5 w-full", view = "used", gauge }: { ratio: number; className?: string; view?: QuotaView; gauge?: QuotaGauge }) {
  const r = Math.min(1, Math.max(0, ratio));
  return (
    <div className={`${className} relative rounded-full bg-surface-2`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r * 100)}>
      <div className="h-full rounded-full" style={{ width: `${r * 100}%`, background: fillColor(r, view) }} />
      {gauge && <EvenPaceMarker gauge={gauge} />}
    </div>
  );
}

/** An overlay: its tip meets the track; its four pixels fit in the existing row padding. */
function EvenPaceMarker({ gauge }: { gauge: QuotaGauge }) {
  const { t } = useI18n();
  const now = useClock();
  const pace = quotaEvenPaceRemaining(gauge, now);
  if (pace === null) return null;
  const title = t("quota.evenPace", { percent: Math.round(pace * 100) });
  return <span data-quota-even-pace className="absolute -top-1 h-1 w-1.5 -translate-x-1/2 text-muted" style={{ left: `${pace * 100}%` }} title={title}>
    <svg className="block" width="6" height="4" viewBox="0 0 6 4" aria-hidden><path d="M0 0h6L3 4z" fill="currentColor" /></svg>
  </span>;
}

/** Compact gauge: "GLM 5h · 已用 38% · 2h 18m" with a small bar underneath (balances: text only). */
export function GaugeChip({ gauge: g }: { gauge: QuotaGauge }) {
  const { t } = useI18n();
  const ratio = usedRatio(g);
  return (
    <span className={`inline-flex min-w-28 flex-col gap-1 tabular-nums ${g.stale ? "opacity-60" : ""}`} title={g.error ?? undefined}>
      <span className="text-xs text-muted">
        {gaugeLabel(g)}
        {" · "}
        {g.kind === "balance" ? formatBalance(g.balance) : ratio === null ? "—" : t("composer.quota.used", { percent: Math.round(ratio * 100) })}
        {g.resetAt ? ` · ${resetsIn(g.resetAt)}` : ""}
        {g.error ? <span className="text-danger"> !</span> : null}
      </span>
      {g.kind !== "balance" && ratio !== null && <GaugeBar ratio={ratio} className="h-1 w-full" />}
    </span>
  );
}
