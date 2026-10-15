// Settings → 数据 → 用量 (DESIGN §4.9). Top to bottom by how often it is needed:
//   1. 额度 — current quota of every profile (one grid: window | bar | % | reset), with provider logos;
//   2. 用量 — cutex token ledger (`GET /v2/usage`): Token total first, line or stacked chart
//      (「总计」 stacks cache read / fresh input / output), breakdown table;
//   3. the price table (API-value estimates) in a dialog opened from the ledger, with
//      「按另一个模型计价」 rows (cutex usage-model-map: price model X as model Y);
//   4. 额外目录 (cutex usage-external-sources): Claude Code / Codex CLI runs outside cutex, with a
//      「来源」 split and a source filter on the ledger.
// 「全部主机」 (header picker, lib/settingsHost useAllHostsTarget): every included host's quotas and
// ledger merged (./merge.ts, ./allHosts.ts), with a 「主机」 split; the price table, model map and
// 额外目录 are still edited on one host, picked in place (the edit host).
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, ArrowRightLeft, Info, X } from "lucide-react";
import type { ProfileItem, UsagePrices, UsageReport, UsageSourceFilter } from "../../../../shared/ipc";
import { USAGE_SOURCES_FEATURE, type UsageSourcesView } from "../../../../shared/usageSources";
import { useI18n, type MessageKey } from "../../i18n";
import { AddButton, ArmedRemove, Button, ErrorNote, IconButton, Loading, PlannedCard, RefreshButton, Segmented, Select } from "../../components/settings/Form";
import { knownProfileNames, useKnownProfiles } from "../../lib/settingsView";
import { applyProfileOrder, profileOrderOf, useProfileOrder } from "../../lib/profileOrder";
import { useUiPrefs } from "../../lib/prefs";
import { formatBalance, gaugeName, latestObservedAt, observedClock, resetsIn, type QuotaGauge } from "../../lib/quota";
import { formatTokens, isoDay, seriesName } from "../../lib/usage";
import { useModulePref } from "../react";
import { buckets, buildSeries, change, CURRENCIES, listSep, remainingColor, remainingRatio, formatMoney, niceScale, OTHER, seriesColor, smoothPath, stack, TOKEN_TYPES, type ChartMode, type Metric, type Split } from "./chart";
import { modelProvider } from "../../lib/provider";
import { withoutDeletedProfiles, type ProfileProviders } from "./provider";
import { rawIdsTitle, withShownModels } from "./models";
import { useModelName } from "../../lib/modelDisplay";
import { useCached } from "./useCached";
import { useProfileProviders } from "./useProfileProviders";
import { ProfileAvatar } from "../../components/ProfileAvatar";
import { ProviderIcon } from "../../components/ProviderIcon";
import { profileColor } from "../../lib/profileLook";
import { daemonApiOf, loadHostQuota, TargetHostContext, useFocusHostId, useHostsQuotas, useTargetApi, useTargetFeatures, useTargetLoadQuota, useTargetQuotas, useTargetHostId } from "../../lib/targetHost";
import { useAllHostsTarget } from "../../lib/settingsHost";
import type { AllHostsChoice } from "../../lib/hostPick";
import { useHostScope, useHostsData } from "../../lib/useHostScope";
import { HostPicker } from "../../components/HostPicker";
import { AllViewContext, loadHostsUsage, useAllView, useHostsProfileProviders, type AllView, type HostResult, type HostTarget } from "./allHosts";
import { canonicalNames, mergeQuotas, mergeUsageReports, profileSignature, reportCurrency, type CurrencyNote, type MergedUnpriced } from "./merge";
import { UsageSources } from "./Sources";
import { useApp } from "../../store";
import { hostData } from "../../lib/hostScope";
import { anyScanning, billingBySeries } from "./sourceHelpers";
import { buildModelMap, manualNames, mapDrafts, mapProblems, mapSuggestions, MODEL_MAP_FEATURE, pricedAsByName, type MapDraft, type MapProblem } from "./modelMap";

const ID = "usage";
const RANGES = [7, 30, 90] as const;
const SPLITS: Split[] = ["total", "profile", "model", "agent", "project"];
/** 「全部主机」 adds the 「主机」 split. */
const ALL_SPLITS: Split[] = [...SPLITS, "host"];
/** Polling while an extra usage source scans. */
const SCAN_POLL_MS = 3000;
const CARD = "rounded-xl border border-border bg-surface";
const CELL_INPUT = "w-full min-w-0 rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums outline-none focus:border-accent";

// ---------------------------------------------------------------- quotas

/** Owner: quota reads as what is left: a full bar = untouched, it shrinks (and warms) as it is used. */
function RemainingBar({ ratio }: { ratio: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
      <div className="h-full rounded-full" style={{ width: `${ratio * 100}%`, background: remainingColor(ratio) }} />
    </div>
  );
}

function GaugeLine({ g }: { g: QuotaGauge }) {
  const { t } = useI18n();
  const ratio = remainingRatio(g.remainingPercent);
  const win = g.windowLabel?.match(/^(\d+)([hd])$/);
  const label = win ? t(win[2] === "h" ? "usage.window.hours" : "usage.window.days", { n: win[1]! }) : g.kind === "balance" && g.label.length <= 3 ? t("usage.balance") : gaugeName(g);
  return (
    <div className={`grid grid-cols-[4.5rem_minmax(0,1fr)_4rem_minmax(0,8rem)] items-center gap-3 py-1 text-sm tabular-nums ${g.stale ? "opacity-60" : ""}`}>
      <span className="truncate text-xs text-muted">{label}</span>
      {g.error ? (
        <span className="col-span-3 truncate text-xs text-danger" title={g.error}>
          {g.error}
        </span>
      ) : g.kind === "balance" ? (
        <span className="col-span-3 font-medium">{formatBalance(g.balance)}</span>
      ) : (
        <>
          {ratio === null ? <span className="text-xs text-subtle">—</span> : <RemainingBar ratio={ratio} />}
          <span className="text-right font-medium">{ratio === null ? "" : t("usage.remaining", { n: Math.round(ratio * 100) })}</span>
          <span className="truncate text-right text-xs text-subtle">{g.resetAt ? t("usage.resetsIn", { time: resetsIn(g.resetAt) }) : ""}</span>
        </>
      )}
    </div>
  );
}

/** How long 额度 waits for every profile's first answer before showing what it has. */
const QUOTA_SETTLE_MS = 2500;

function Quotas({ providers, settled }: { providers: ProfileProviders; settled: boolean }) {
  const { t, locale } = useI18n();
  // Agents (also archived ones) remember the profile they ran on; skip the ones deleted since.
  const known = useKnownProfiles();
  // In the owner's manual profile order (lib/profileOrder); without one, by name as before.
  const order = useProfileOrder(useTargetHostId());
  const profiles = useMemo(() => (providers ? applyProfileOrder(known.flatMap((n) => providers.get(n) ?? []), order).map((p) => p.name) : known), [known, providers, order]);
  const quotas = useTargetQuotas();
  const loadQuota = useTargetLoadQuota();
  useEffect(() => {
    for (const p of profiles) void loadQuota(p);
  }, [profiles, loadQuota]);
  // Answers arrive one profile at a time; adding rows as they come pushed 用量 below down again
  // and again. Show the section once everything is in (or after QUOTA_SETTLE_MS), then keep it.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), QUOTA_SETTLE_MS);
    return () => clearTimeout(timer);
  }, []);
  const shown = useRef(false);
  if (waited || (settled && profiles.every((p) => quotas[p] !== undefined))) shown.current = true;
  const observed = latestObservedAt(profiles.flatMap((p) => quotas[p] ?? []));
  // Profiles with gauges first; the ones that report nothing collapse into one muted line.
  const withGauges = profiles.filter((p) => (quotas[p] ?? []).length > 0);
  const without = profiles.filter((p) => (quotas[p] ?? []).length === 0);
  return (
    <section className="mb-8">
      <div className="mb-2 flex h-7 items-center gap-2">
        <h3 className="text-sm font-semibold">{t("usage.quotas")}</h3>
        {observed && <span className="text-xs text-subtle">{t("usage.updatedAt", { time: observedClock(observed) })}</span>}
        <span className="ml-auto">
          <RefreshButton label={t("usage.refresh")} onClick={() => profiles.forEach((p) => void loadQuota(p, true))} />
        </span>
      </div>
      <div className={`${CARD} divide-y divide-border px-4`}>
        {!shown.current && <Loading rows={Math.min(Math.max(profiles.length, 2), 6)} />}
        {shown.current && withGauges.map((p) => (
          <div key={p} className="grid grid-cols-[8rem_minmax(0,1fr)] items-start gap-4 py-2.5">
            <span className="flex min-w-0 items-center gap-2">
              {providers?.get(p) ? <ProfileAvatar profile={providers.get(p)!} size={22} badge /> : <ProviderIcon provider={null} name={p} size={22} />}
              <span className="truncate text-sm font-medium">{p}</span>
            </span>
            <div>
              {(quotas[p] ?? []).map((g) => (
                <GaugeLine key={g.id} g={g} />
              ))}
            </div>
          </div>
        ))}
        {shown.current && without.length > 0 && <div className="py-2.5 text-xs text-subtle">{t("usage.noQuota", { names: without.join(listSep(locale)) })}</div>}
      </div>
    </section>
  );
}

/**
 * 「全部主机」 额度: one card per profile name. The same account on several hosts shows its freshest
 * observation (gauges are never added up) with 「来自 host」; another provider under the same name keeps
 * its own card (`name · host`).
 */
function AllQuotas({ view }: { view: AllView }) {
  const { t, locale } = useI18n();
  const sep = listSep(locale);
  const ids = useMemo(() => view.targets.map((x) => x.hostId), [view.targets]);
  const data = useHostsData(ids);
  const quotas = useHostsQuotas(ids);
  useUiPrefs(); // each host's manual profile order (lib/profileOrder)
  const entries = useMemo(() => {
    const out: { hostId: string; label: string; name: string; signature: string | null }[] = [];
    for (const x of view.targets) {
      const providers = view.providers?.get(x.hostId);
      // Every profile the host lists (like the 用量 flyout), in its manual order; without a list, the
      // profiles its agents ran on.
      const names = providers ? applyProfileOrder([...providers.values()], profileOrderOf(x.hostId)).map((p) => p.name) : knownProfileNames(data.find((d) => d.hostId === x.hostId)?.sidebar);
      for (const name of names) out.push({ hostId: x.hostId, label: x.label, name, signature: profileSignature(providers?.get(name)) });
    }
    return out;
  }, [view.targets, view.providers, data]);
  useEffect(() => {
    for (const e of entries) void loadHostQuota(e.hostId, e.name);
  }, [entries]);
  const cards = useMemo(() => mergeQuotas(entries.map((e) => ({ ...e, gauges: quotas[e.hostId]?.[e.name] }))), [entries, quotas]);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), QUOTA_SETTLE_MS);
    return () => clearTimeout(timer);
  }, []);
  const shown = useRef(false);
  if (waited || (view.providers !== undefined && cards.every((c) => c.loaded))) shown.current = true;
  const observed = latestObservedAt(cards.flatMap((c) => c.gauges));
  const title = (c: (typeof cards)[number]) => (c.split ? `${c.name} · ${c.hosts.join(sep)}` : c.name);
  const withGauges = cards.filter((c) => c.gauges.length > 0);
  const without = cards.filter((c) => c.gauges.length === 0);
  return (
    <section className="mb-8">
      <div className="mb-2 flex h-7 items-center gap-2">
        <h3 className="text-sm font-semibold">{t("usage.quotas")}</h3>
        {observed && <span className="text-xs text-subtle">{t("usage.updatedAt", { time: observedClock(observed) })}</span>}
        <span className="ml-auto">
          {/* A refresh only re-reads the providers' quota (no setting changes): every included host. */}
          <RefreshButton label={t("usage.all.refresh")} onClick={() => entries.forEach((e) => void loadHostQuota(e.hostId, e.name, true))} />
        </span>
      </div>
      <div className={`${CARD} divide-y divide-border px-4`}>
        {!shown.current && <Loading rows={Math.min(Math.max(cards.length, 2), 6)} />}
        {shown.current &&
          withGauges.map((c) => {
            const profile = view.providers?.get(c.fromHostId ?? c.hostIds[0]!)?.get(c.name) ?? [...c.hostIds].map((h) => view.providers?.get(h)?.get(c.name)).find(Boolean);
            const others = c.hosts.filter((h) => h !== c.from);
            return (
              <div key={c.key} className="grid grid-cols-[10rem_minmax(0,1fr)] items-start gap-4 py-2.5">
                <span className="flex min-w-0 items-center gap-2">
                  {profile ? <ProfileAvatar profile={profile} size={22} badge /> : <ProviderIcon provider={null} name={c.name} size={22} />}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium" title={title(c)}>
                      {title(c)}
                    </span>
                    {c.from && (
                      <span className="block truncate text-[11px] text-subtle" title={t("usage.all.quotaHosts", { hosts: c.hosts.join(sep) })}>
                        {others.length ? t("usage.all.quotaFromAlso", { host: c.from, hosts: others.join(sep) }) : t("usage.all.quotaFrom", { host: c.from })}
                      </span>
                    )}
                  </span>
                </span>
                <div>
                  {c.gauges.map((g) => (
                    <GaugeLine key={g.id} g={g} />
                  ))}
                </div>
              </div>
            );
          })}
        {shown.current && without.length > 0 && <div className="py-2.5 text-xs text-subtle">{t("usage.noQuota", { names: without.map(title).join(sep) })}</div>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- series labels / marks

function useSeriesLabel(split: Split): (s: string) => string {
  const { t } = useI18n();
  return (s) => (split === "total" ? t(`usage.type.${s}` as MessageKey) : s);
}

/** 「全部主机」: host label → host color (the 「主机」 split). */
const HostColors = createContext<ReadonlyMap<string, string> | null>(null);

/** Series colour: a profile keeps its own colour (Settings → Profile → 外观), a host its host colour, the rest the chart palette. */
function colorOf(split: Split, providers: ProfileProviders, series: readonly string[], name: string, hosts?: ReadonlyMap<string, string> | null): string {
  const profile = split === "profile" ? providers?.get(name) : undefined;
  const host = split === "host" ? hosts?.get(name) : undefined;
  return profile ? profileColor(profile) : (host ?? seriesColor(series, name));
}

/** Shown model name → its raw ids (modules/usage/models), for the 模型 split. */
type ModelIds = ReadonlyMap<string, readonly string[]> | null;

/** Legend / table / tooltip mark: the profile's avatar, a model's provider logo, else a colour dot. */
function SeriesMark({ split, name, color, providers, modelIds }: { split: Split; name: string; color: string; providers: ProfileProviders; modelIds?: ModelIds }) {
  const profile = split === "profile" ? providers?.get(name) : undefined;
  if (profile) return <ProfileAvatar profile={profile} size={16} color={color} />;
  // The logo comes from the raw id: a display name ("DS Flash") need not name its provider.
  const provider = split === "model" ? modelProvider(modelIds?.get(name)?.[0] ?? name) : null;
  return (
    <span className="relative inline-flex shrink-0 items-center">
      {provider ? <ProviderIcon provider={provider} name={name} size={14} /> : <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      {provider && <span className="absolute -right-0.5 -bottom-0.5 h-1.5 w-1.5 rounded-full ring-1 ring-surface" style={{ background: color }} />}
    </span>
  );
}

// ---------------------------------------------------------------- summary

function Stat({ label, value, sub, hint }: { label: ReactNode; value: string; sub?: string; hint?: string }) {
  return (
    <div className="border-l border-border pl-4">
      <div className="flex items-center gap-1 text-xs text-subtle" title={hint}>
        {label}
        {hint && <Info size={11} />}
      </div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-subtle tabular-nums">{sub}</div>}
    </div>
  );
}

function Summary({ report, previous, range }: { report: UsageReport; previous: UsageReport | null; range: number }) {
  const { t } = useI18n();
  const tt = report.totals;
  const delta = change(tt.total, previous?.totals.total);
  const cacheRate = tt.input > 0 ? tt.cachedInput / tt.input : null;
  const apiValue = tt.estimatedCost !== undefined ? formatMoney(tt.estimatedCost, report.currency) : tt.apiEquivalentUsd !== undefined ? formatMoney(tt.apiEquivalentUsd, "USD") : null;
  return (
    <div className="mb-4 flex flex-wrap items-end gap-x-10 gap-y-3">
      <div>
        <div className="text-xs text-subtle">{t("usage.tokens")}</div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tracking-tight tabular-nums">{formatTokens(tt.total)}</span>
          {delta !== null && (
            <span className="text-xs text-muted tabular-nums">
              {Math.abs(delta) < 0.005 ? t("usage.flat") : `${delta > 0 ? "↑" : "↓"} ${Math.abs(Math.round(delta * 100))}%`} <span className="text-subtle">{t("usage.vsPrev", { n: range })}</span>
            </span>
          )}
        </div>
        <div className="text-[11px] text-subtle tabular-nums">{t("usage.inOut", { i: formatTokens(tt.input), o: formatTokens(tt.output) })}</div>
      </div>
      {cacheRate !== null && <Stat label={t("usage.cacheRate")} value={`${Math.round(cacheRate * 100)}%`} sub={t("usage.cachedTokens", { n: formatTokens(tt.cachedInput) })} />}
      <Stat label={t("usage.turns")} value={String(tt.turns)} sub={t("usage.perDay", { n: (tt.turns / range).toFixed(1) })} />
      {apiValue && <Stat label={t("usage.apiValue")} value={apiValue} sub={t("usage.apiValueSub")} hint={t("usage.apiValueHint")} />}
    </div>
  );
}

// ---------------------------------------------------------------- chart

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

interface ChartProps {
  report: UsageReport;
  split: Split;
  days: string[];
  metric: Metric;
  mode: ChartMode;
  focus: string | null;
  onFocus(s: string | null): void;
  providers: ProfileProviders;
  modelIds: ModelIds;
  controls: ReactNode;
}

function Chart({ report, split, days, metric, mode, focus, onFocus, providers, modelIds, controls }: ChartProps) {
  const { t } = useI18n();
  const label = useSeriesLabel(split);
  const bks = useMemo(() => buckets(days), [days]);
  const { series, values } = useMemo(() => buildSeries(report, split, bks, metric), [report, split, bks, metric]);
  const stacked = mode === "stacked" && series.length > 1;
  const tops = useMemo(() => (stacked ? stack(values) : values), [stacked, values]);
  const [wrap, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const fmt = (v: number) => (metric === "cost" ? formatMoney(v, report.currency) : formatTokens(Math.round(v)));
  const H = 200;
  const pad = { l: 46, r: 12, t: 10, b: 22 };
  const max = Math.max(0, ...tops.flat());
  const scale = niceScale(max);
  const iw = Math.max(1, width - pad.l - pad.r);
  const ih = H - pad.t - pad.b;
  const n = bks.length;
  const x = (i: number) => pad.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / scale.max) * ih;
  const ticks: number[] = [];
  for (let v = 0; v <= scale.max + 1e-9; v += scale.step) ticks.push(v);
  const labelEvery = Math.ceil(n / Math.max(2, Math.floor(iw / 64)));
  const dim = (s: string) => (focus !== null && focus !== s ? 0.15 : 1);
  const hostColors = useContext(HostColors);
  const color = (s: string) => colorOf(split, providers, series, s, hostColors);
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rel = (e.clientX - e.currentTarget.getBoundingClientRect().left - pad.l) / iw;
    setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
  };
  const hoverRows = hover === null ? [] : series.map((s, si) => ({ s, v: values[si]![hover]! })).filter((r) => r.v > 0);
  if (!stacked) hoverRows.sort((a, b) => b.v - a.v);
  else hoverRows.reverse(); // top of the stack first, like the picture
  const hoverSum = hoverRows.reduce((a, r) => a + r.v, 0);
  // Stacked: draw from the top series down so each band's fill covers only its own slice.
  const order = stacked ? series.map((_, i) => series.length - 1 - i) : series.map((_, i) => i);
  return (
    <div className={`${CARD} mb-4 p-4`}>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        {series.map((s) => (
          <button key={s} onMouseEnter={() => onFocus(s)} onMouseLeave={() => onFocus(null)} className="flex items-center gap-1.5 text-muted hover:text-foreground" style={{ opacity: dim(s) === 1 ? 1 : 0.5 }}>
            <SeriesMark split={split} name={s} color={color(s)} providers={providers} modelIds={modelIds} />
            {label(s)}
          </button>
        ))}
        {n < days.length && <span className="text-subtle">· {t("usage.weekly")}</span>}
        <span className="ml-auto flex gap-2">{controls}</span>
      </div>
      {/* fixed height: the svg appears only once the width is known, and must not push the table */}
      <div ref={wrap} className="relative" style={{ height: H }} onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={H} onMouseMove={onMove} className="block select-none">
            <defs>
              {series.map((s, i) => (
                <linearGradient key={s} id={`${ID}-fill-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color(s)} stopOpacity={stacked ? 0.55 : 0.18} />
                  <stop offset="100%" stopColor={color(s)} stopOpacity={stacked ? 0.3 : 0} />
                </linearGradient>
              ))}
            </defs>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeDasharray={v === 0 ? undefined : "3 4"} />
                <text x={pad.l - 8} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="var(--fg-subtle)">
                  {v === 0 ? "0" : fmt(v)}
                </text>
              </g>
            ))}
            {bks.map((b, i) =>
              (i % labelEvery === 0 && n - 1 - i >= labelEvery * 0.6) || i === n - 1 ? (
                <text key={b.label} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize={10} fill="var(--fg-subtle)">
                  {b.label.slice(5)}
                </text>
              ) : null,
            )}
            {order.map((si) => {
              const s = series[si]!;
              const top = tops[si]!.map((v, i) => [x(i), y(v)] as [number, number]);
              const line = smoothPath(top);
              const base = stacked && si > 0 ? tops[si - 1]!.map((v, i) => [x(i), y(v)] as [number, number]).reverse() : null;
              const area = base ? `${line} ${smoothPath(base, false)} Z` : `${line} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`;
              return (
                <g key={s} style={{ opacity: dim(s), transition: "opacity 120ms" }}>
                  <path d={area} fill={`url(#${ID}-fill-${si})`} />
                  <path d={line} fill="none" stroke={color(s)} strokeWidth={stacked ? 1.5 : 2} strokeLinejoin="round" strokeLinecap="round" />
                </g>
              );
            })}
            {hover !== null && (
              <g pointerEvents="none">
                <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--fg-subtle)" strokeOpacity={0.5} />
                {series.map((s, si) => (
                  <circle key={s} cx={x(hover)} cy={y(tops[si]![hover]!)} r={3.5} fill="var(--surface)" stroke={color(s)} strokeWidth={2} style={{ opacity: dim(s) }} />
                ))}
              </g>
            )}
          </svg>
        )}
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-1 min-w-40 rounded-lg border border-border bg-raised px-2.5 py-1.5 text-xs shadow-lg"
            style={x(hover) > width / 2 ? { right: width - x(hover) + 10 } : { left: x(hover) + 10 }}
          >
            <div className="mb-1 font-medium tabular-nums">{bks[hover]!.days.length > 1 ? `${bks[hover]!.days[0]} – ${bks[hover]!.days.at(-1)!.slice(5)}` : bks[hover]!.label}</div>
            {hoverRows.length === 0 && <div className="text-subtle">{t("usage.noUse")}</div>}
            {hoverRows.map((r) => (
              <div key={r.s} className="flex items-center gap-2">
                <SeriesMark split={split} name={r.s} color={color(r.s)} providers={providers} modelIds={modelIds} />
                <span className="text-muted">{label(r.s)}</span>
                <span className="ml-auto pl-3 tabular-nums">{fmt(r.v)}</span>
              </div>
            ))}
            {hoverRows.length > 1 && (
              <div className="mt-1 flex border-t border-border pt-1">
                <span className="text-muted">{t("usage.sum")}</span>
                <span className="ml-auto tabular-nums">{fmt(hoverSum)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- breakdown table

interface Row {
  name: string;
  turns?: number;
  input?: number;
  output?: number;
  total: number;
  cost?: number;
}

function Breakdown({ report, split, metric, focus, onFocus, providers, modelIds }: { report: UsageReport; split: Split; metric: Metric; focus: string | null; onFocus(s: string | null): void; providers: ProfileProviders; modelIds: ModelIds }) {
  const { t, locale } = useI18n();
  const label = useSeriesLabel(split);
  const rows = useMemo<Row[]>(() => {
    if (split === "total") {
      const tt = report.totals;
      return [
        { name: "cached", total: tt.cachedInput },
        { name: "fresh", total: Math.max(0, tt.input - tt.cachedInput) },
        { name: "output", total: tt.output },
      ];
    }
    const map = new Map<string, Row & { turns: number; input: number; output: number }>();
    for (const row of report.rows) {
      const name = seriesName(row.key, split);
      const cur = map.get(name) ?? { name, turns: 0, input: 0, output: 0, total: 0 };
      cur.turns += row.turns;
      cur.input += row.input;
      cur.output += row.output;
      cur.total += row.total;
      if (row.estimatedCost !== undefined) cur.cost = (cur.cost ?? 0) + row.estimatedCost;
      map.set(name, cur);
    }
    return [...map.values()].sort((a, b) => (metric === "cost" ? (b.cost ?? 0) - (a.cost ?? 0) : b.total - a.total));
  }, [report, split, metric]);
  const byCost = metric === "cost" && split !== "total";
  const whole = rows.reduce((a, r) => a + (byCost ? (r.cost ?? 0) : r.total), 0) || 1;
  // Same colours as the chart: the chart's top names keep theirs, the rest share the "…" colour.
  const chartSeries = split === "total" ? [...TOKEN_TYPES] : rows.length > 6 ? [...rows.slice(0, 5).map((r) => r.name), OTHER] : rows.map((r) => r.name);
  const detail = split !== "total";
  // 来源: a subscription source's cost is what the same tokens would cost on the API, not spend.
  const billing = useMemo(() => (split === "source" ? billingBySeries(report) : null), [report, split]);
  // 模型: 「按 Y 计价」 on models the price table maps to another model (cutex usage-model-map).
  const pricedAs = useMemo(() => (split === "model" ? pricedAsByName(report.rows, (row) => seriesName(row.key, split)) : null), [report, split]);
  const modelName = useModelName();
  const hostColors = useContext(HostColors);
  const th = "py-2 text-right font-normal";
  return (
    <div className={`${CARD} mb-2 px-4 py-1`}>
      <table className="w-full text-sm">
        <thead className="text-xs text-subtle">
          <tr className="text-left">
            <th className="py-2 font-normal">{t(`usage.by.${split}` as MessageKey)}</th>
            <th className="w-[24%] py-2 font-normal">{t("usage.share")}</th>
            {detail && <th className={th}>{t("usage.turns")}</th>}
            {detail && <th className={th}>{t("usage.inputOutput")}</th>}
            <th className={th}>{t("usage.tokens")}</th>
            {detail && report.currency && <th className={th}>{t("usage.apiValue")}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const share = (byCost ? (r.cost ?? 0) : r.total) / whole;
            const color = colorOf(split, providers, chartSeries, r.name, hostColors);
            return (
              <tr key={r.name} onMouseEnter={() => onFocus(r.name)} onMouseLeave={() => onFocus(null)} className={`border-t border-border tabular-nums transition-opacity ${focus !== null && focus !== r.name ? "opacity-50" : ""}`}>
                <td className="py-2">
                  <span className="flex items-center gap-2">
                    <SeriesMark split={split} name={r.name} color={color} providers={providers} modelIds={modelIds} />
                    <span className="truncate" title={rawIdsTitle(modelIds, r.name)}>{label(r.name)}</span>
                    {pricedAs?.get(r.name) && (
                      <span className="shrink-0 rounded bg-surface-2 px-1.5 py-px text-[11px] text-muted" title={t("usage.map.pricedAsHint", { to: pricedAs.get(r.name)!.join(", ") })}>
                        {t("usage.map.pricedAs", { to: pricedAs.get(r.name)!.map((id) => modelName(id)).join(listSep(locale)) })}
                      </span>
                    )}
                    {billing?.get(r.name) && (
                      <span className="shrink-0 rounded bg-surface-2 px-1.5 py-px text-[11px] text-muted" title={billing.get(r.name) === "subscription" ? t("usage.sources.subscriptionHint") : undefined}>
                        {t(billing.get(r.name) === "subscription" ? "usage.sources.tag.subscription" : "usage.sources.tag.api")}
                      </span>
                    )}
                  </span>
                </td>
                <td className="py-2 pr-4">
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <span className="block h-full rounded-full" style={{ width: `${share * 100}%`, background: color }} />
                    </span>
                    <span className="w-9 text-right text-xs text-muted">{Math.round(share * 100)}%</span>
                  </span>
                </td>
                {detail && <td className="py-2 text-right text-muted">{r.turns}</td>}
                {detail && (
                  <td className="py-2 text-right text-muted">
                    {formatTokens(r.input ?? 0)} <span className="text-subtle">/</span> {formatTokens(r.output ?? 0)}
                  </td>
                )}
                <td className="py-2 text-right font-medium">{formatTokens(r.total)}</td>
                {detail && report.currency && <td className="py-2 text-right text-muted">{r.cost !== undefined ? formatMoney(r.cost, report.currency) : "—"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- ledger

/** A ledger answer: one host's report, or (「全部主机」) every host's. */
type LedgerData = { single: UsageReport | null } | { parts: HostResult[] };

/** The edit host picker of 「全部主机」 (price table / model map / 额外目录 live on one host). */
function EditHostPicker({ view }: { view: AllView }) {
  const { t } = useI18n();
  return <HostPicker value={view.editHost} onChange={view.setEditHost} mode="picker" only={view.targets.map((x) => x.hostId)} title={t("usage.all.editHostTitle")} />;
}

function Ledger({ providers, sources, refresh }: { providers: ProfileProviders; sources: UsageSourcesView | null | undefined; refresh: number }) {
  // 「全部主机」: `api` / the target host are the edit host (price table); the ledger reads every host.
  const view = useAllView();
  const api = useTargetApi();
  const { t, locale } = useI18n();
  const [range, setRange] = useModulePref<number>(ID, "range", 7);
  const [savedSplit, setSplit] = useModulePref<Split>(ID, "split", "total");
  // 来源 split and the source filter only where cutex keeps extra usage sources (all hosts: any of them).
  const targetSources = useTargetFeatures().has(USAGE_SOURCES_FEATURE);
  const hasSources = view ? view.targets.some((x) => x.sources) : targetSources;
  const baseSplits = view ? ALL_SPLITS : SPLITS;
  const splits = hasSources ? [...baseSplits, "source" as const] : baseSplits;
  const split: Split = splits.includes(savedSplit) ? savedSplit : "total";
  const [savedSource, setSource] = useModulePref<string>(ID, "source", "all");
  const sourceOptions = useMemo(
    () => [
      { value: "all", label: t("usage.sources.filter.all") },
      { value: "cutex", label: t("usage.sources.filter.cutex") },
      // One source's id is one host's: 「全部主机」 offers the kinds only.
      ...(view ? (hasSources ? [{ value: "external", label: t("usage.sources.filter.external") }] : []) : sources?.sources.length ? [{ value: "external", label: t("usage.sources.filter.external") }, ...sources.sources.map((s) => ({ value: s.id, label: s.label }))] : []),
    ],
    [sources, t, view, hasSources],
  );
  const sourceFilter = hasSources && sourceOptions.some((o) => o.value === savedSource) ? savedSource : "all";
  const source: UsageSourceFilter | undefined = sourceFilter === "all" ? undefined : sourceFilter;
  const [metric, setMetric] = useModulePref<Metric>(ID, "metric", "tokens");
  // 「总计」 reads best stacked (the token types add up), a split reads best as lines.
  const [modeTotal, setModeTotal] = useModulePref<ChartMode>(ID, "chart.total", "stacked");
  const [modeSplit, setModeSplit] = useModulePref<ChartMode>(ID, "chart.split", "line");
  const mode = split === "total" ? modeTotal : modeSplit;
  const [focus, setFocus] = useState<string | null>(null);
  const [editing, setEditing] = useState<string[] | null>(null);
  const [version, setVersion] = useState(0);
  const days = useMemo(() => {
    const out: string[] = [];
    for (let i = range - 1; i >= 0; i--) out.push(isoDay(new Date(Date.now() - i * 86_400_000)));
    return out;
  }, [range]);
  // Cached per host + query: reopening the page shows the last numbers while they refresh.
  const host = useTargetHostId();
  const scopeKey = view ? `*${view.targets.map((x) => x.hostId).join(",")}` : host;
  const load = (q: Parameters<typeof api.usage>[0]): Promise<LedgerData> => (view ? loadHostsUsage(view.targets, q).then((parts) => ({ parts })) : api.usage(q).then((single) => ({ single })));
  const mainQuery = { from: days[0], to: days.at(-1), groupBy: split === "total" ? ["day" as const] : ["day" as const, ...(split === "host" ? [] : [split])], ...(source ? { source } : {}) };
  const prevQuery = { from: isoDay(new Date(Date.now() - (2 * range - 1) * 86_400_000)), to: isoDay(new Date(Date.now() - range * 86_400_000)), groupBy: ["day" as const], ...(source ? { source } : {}) };
  const modelQuery = { from: days[0], to: days.at(-1), groupBy: ["model" as const], ...(source ? { source } : {}) };
  const main = useCached(`${scopeKey}|${JSON.stringify(mainQuery)}`, () => load(mainQuery), version + refresh);
  const prevData = useCached(`${scopeKey}|${JSON.stringify(prevQuery)}`, () => load(prevQuery).catch(() => null), version + refresh).data ?? null;
  // The price table's helpers (models used, older cutex's unpriced list): the edit host's.
  const byModel = useCached(`${host}|${JSON.stringify(modelQuery)}`, () => api.usage(modelQuery).catch(() => null), version + refresh).data ?? null;
  const prices = useCached(`${host}|prices`, () => api.usagePrices().catch(() => null), version).data ?? null;
  // 「全部主机」: merge the hosts that answered (deleted profiles dropped per host, before names merge).
  const merge = useCallback(
    (parts: HostResult[], dropDeleted: boolean) => {
      if (!view) return null;
      const ok = parts.filter((p): p is HostResult & { report: UsageReport } => !!p.report).map((p) => ({ ...p, report: dropDeleted ? withoutDeletedProfiles(p.report, view.providers?.get(p.hostId) ?? null) : p.report }));
      if (!ok.length) return null;
      const primary = ok.find((p) => p.hostId === view.primary)?.report;
      return mergeUsageReports(ok, { currency: primary ? reportCurrency(primary) : undefined, canonical: view.canonical });
    },
    [view],
  );
  const mainParts = main.data && "parts" in main.data ? main.data.parts : null;
  const merged = useMemo(() => (mainParts ? merge(mainParts, split === "profile") : null), [mainParts, merge, split]);
  const prevMerged = useMemo(() => (prevData && "parts" in prevData ? merge(prevData.parts, false) : null), [prevData, merge]);
  // undefined = loading, null = no ledger (one host: this cutex; all hosts: none of them).
  const report: UsageReport | null | undefined = !main.data ? undefined : "single" in main.data ? main.data.single : (merged?.report ?? null);
  const previous = prevData ? ("single" in prevData ? prevData.single : (prevMerged?.report ?? null)) : null;
  // All hosts failed: their errors stand in for the one error.
  const error = main.error ?? (mainParts && !merged && mainParts.some((p) => p.error) ? mainParts.filter((p) => p.error).map((p) => `${p.label}: ${p.error}`).join("\n") : null);
  // Models used in this range that the price table does not know: their API value counts as 0.
  const unpriced = useMemo(() => {
    // Newer cutex prices from a library too and names what it could not price; older: manual table only.
    if (report?.unpricedModels) return [...new Set(report.unpricedModels.filter((m) => m.tokens > 0 && m.model).map((m) => m.model!))];
    if (!byModel || !prices) return [];
    return [...new Set(byModel.rows.filter((r) => r.total > 0 && r.key.model && !prices.models[r.key.model]).map((r) => r.key.model!))];
  }, [report, byModel, prices]);
  // usage-model-map: unpriced models mapped to a model without a price either (shown as 「X → Y」).
  const unpricedTo = useMemo(() => new Map((report?.unpricedModels ?? []).filter((m) => m.pricedAs && m.model).map((m) => [m.model!, m.pricedAs!])), [report]);
  // 「全部主机」: which hosts reported each unpriced model (prices are set on one host at a time).
  const unpricedHosts = useMemo(() => {
    const out = new Map<string, string[]>();
    if (!merged) return out;
    for (const m of merged.report.unpricedModels as MergedUnpriced[]) for (const h of m.hosts) if (m.model && m.tokens > 0) out.set(h, [...(out.get(h) ?? []), m.model]);
    return out;
  }, [merged]);
  const canMap = useTargetFeatures().has(MODEL_MAP_FEATURE);
  const usedModels = useMemo(() => [...new Set((byModel?.rows ?? []).map((r) => r.key.model).filter((m): m is string => !!m))], [byModel]);
  const hasCost = report?.totals.estimatedCost !== undefined;
  // Owner: deleted profiles do not appear under the Profile split; the summary keeps cutex's totals.
  // 模型: names from Settings → 通用 → 模型显示名; ids shown alike add up (display only).
  const modelName = useModelName();
  const named = useMemo(() => (report && split === "model" ? withShownModels(report, (id) => modelName(id)) : null), [report, split, modelName]);
  const shown = useMemo(() => (report && split === "profile" && !view ? withoutDeletedProfiles(report, providers) : (named?.report ?? report)), [report, split, providers, named, view]);
  const shownMetric: Metric = hasCost ? metric : "tokens";
  const canStack = !(split === "total" && shownMetric === "cost");
  const hostLabel = (id: string) => view?.targets.find((x) => x.hostId === id)?.label ?? id;
  const openPrices = (hostId: string, models: string[]) => {
    view?.setEditHost(hostId);
    setEditing(models);
  };

  const chartControls = (
    <>
      {canStack && (
        <Segmented
          value={mode}
          options={[
            { value: "line", label: t("usage.chart.line") },
            { value: "stacked", label: t("usage.chart.stacked") },
          ]}
          onChange={(v) => (split === "total" ? setModeTotal(v) : setModeSplit(v))}
        />
      )}
      {hasCost && (
        <Segmented
          value={shownMetric}
          options={[
            { value: "tokens", label: t("usage.tokens") },
            { value: "cost", label: t("usage.apiValue") },
          ]}
          onChange={setMetric}
        />
      )}
    </>
  );

  return (
    <section className="mb-6">
      <div className="mb-3 flex min-h-7 flex-wrap items-center gap-2">
        <h3 className="shrink-0 text-sm font-semibold">{t("usage.ledger")}</h3>
        {/* Wraps under the title when the page is narrow (「全部主机」 adds a split). */}
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          {hasSources && sourceOptions.length > 2 && <Select width="w-36" value={sourceFilter} options={sourceOptions} onChange={setSource} label={t("usage.sources.filter")} />}
          <Segmented value={split} options={splits.map((s) => ({ value: s, label: t(`usage.by.${s}` as MessageKey) }))} onChange={setSplit} />
          <Segmented value={String(range)} options={RANGES.map((r) => ({ value: String(r), label: t("usage.days", { n: r }) }))} onChange={(v) => setRange(Number(v))} />
        </div>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {report === undefined && !error && (
        <div className={`${CARD} px-4 py-1`}>
          <Loading rows={3} />
        </div>
      )}
      {report === null && !error && (
        <div className={`${CARD} px-4 py-1`}>
          <PlannedCard api="GET /v2/usage">{t("usage.unsupported")}</PlannedCard>
        </div>
      )}
      {report && (
        <>
          <Summary report={report} previous={previous} range={range} />
          {merged && merged.unconverted.length > 0 && <UnconvertedNote notes={merged.unconverted} currency={report.currency} />}
          <Chart report={shown ?? report} split={split} days={days} metric={shownMetric} mode={canStack ? mode : "line"} focus={focus} onFocus={setFocus} providers={providers} modelIds={named?.ids ?? null} controls={chartControls} />
          <Breakdown report={shown ?? report} split={split} metric={shownMetric} focus={focus} onFocus={setFocus} providers={providers} modelIds={named?.ids ?? null} />
          {unpriced.length > 0 && (
            <div className="mb-1.5 flex items-center gap-1.5 text-xs text-warn">
              <AlertTriangle size={12} className="shrink-0" />
              <span className="truncate" title={unpriced.join(listSep(locale))}>{t("usage.unpriced", { n: unpriced.length, names: unpriced.map((id) => (unpricedTo.has(id) ? `${modelName(id)} → ${modelName(unpricedTo.get(id)!)}` : modelName(id))).join(listSep(locale)) })}</span>
              {view ? (
                // Prices are set per host: one link per host that reported unpriced models.
                [...unpricedHosts].map(([h, models]) => (
                  <button key={h} className="shrink-0 underline underline-offset-2 hover:text-foreground" onClick={() => openPrices(h, models)}>
                    {t("usage.all.setPricesOn", { host: hostLabel(h) })}
                  </button>
                ))
              ) : (
                <button className="shrink-0 underline underline-offset-2 hover:text-foreground" onClick={() => setEditing(unpriced)}>
                  {t("usage.setPrices")}
                </button>
              )}
            </div>
          )}
          <div className="flex items-center gap-3 text-xs text-subtle">
            <span className="min-w-0 truncate">
              {report.recordingSince ? t("usage.since", { date: report.recordingSince.slice(0, 10) }) : ""} {t("usage.apiValueNote")}
              {report.pricing?.catalog && ` ${t("usage.catalog", { source: report.pricing.catalog.source, date: (report.pricing.catalog.fetchedAt ?? "—").slice(0, 10) })}`}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-2">
              {view && <EditHostPicker view={view} />}
              <button className="shrink-0 text-muted underline-offset-2 hover:text-foreground hover:underline" disabled={!prices} onClick={() => setEditing([])}>
                {t("usage.editPrices")}
              </button>
            </span>
          </div>
        </>
      )}
      {view && mainParts && <HostsNote view={view} parts={mainParts} converted={merged?.converted ?? []} currency={report?.currency} />}
      {editing && prices && (
        <PricesDialog
          prices={prices}
          host={view ? hostLabel(view.editHost) : undefined}
          add={editing.filter((m) => !unpricedTo.has(m))}
          usedModels={usedModels}
          unpriced={view ? (unpricedHosts.get(view.editHost) ?? []) : unpriced}
          canMap={canMap}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </section>
  );
}

/** 「全部主机」: hosts whose API value is in a currency the view could not convert (left out of every cost). */
function UnconvertedNote({ notes, currency }: { notes: CurrencyNote[]; currency: string | undefined }) {
  const { t, locale } = useI18n();
  return (
    <div className="mb-3 flex items-start gap-1.5 text-xs text-warn">
      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
      <span>{t("usage.all.unconverted", { hosts: notes.map((n) => t("usage.all.hostAmount", { host: n.label, amount: formatMoney(n.cost, n.currency) })).join(listSep(locale)), currency: currency ?? "—" })}</span>
    </div>
  );
}

/** 「全部主机」: which hosts the numbers include, which are left out and why, and any currency conversion. */
function HostsNote({ view, parts, converted, currency }: { view: AllView; parts: HostResult[]; converted: CurrencyNote[]; currency: string | undefined }) {
  const { t, locale } = useI18n();
  const sep = listSep(locale);
  const included = parts.filter((p) => p.report).map((p) => p.label);
  const left = [
    ...parts.filter((p) => !p.report).map((p) => (p.error ? t("usage.all.excluded.failed", { host: p.label, error: p.error }) : t("usage.all.excluded.unsupported", { host: p.label }))),
    ...view.excluded.map((x) => t(`usage.all.excluded.${x.reason}` as MessageKey, { host: x.label })),
  ];
  return (
    <div className="mt-2 space-y-0.5 text-xs text-subtle">
      <div className="flex items-start gap-1.5">
        <Info size={12} className="mt-0.5 shrink-0" />
        <span>
          {t("usage.all.included", { hosts: included.join(sep) || "—" })}
          {left.length > 0 && ` · ${t("usage.all.excluded", { hosts: left.join(sep) })}`}
        </span>
      </div>
      {/* Each cutex buckets days in its own local time zone and reports no zone; the merge adds same-day rows. */}
      {included.length > 1 && <div className="pl-[18px]">{t("usage.all.localDays")}</div>}
      {converted.length > 0 && currency && (
        <div className="pl-[18px]">{t("usage.all.converted", { currency, hosts: converted.map((n) => t("usage.all.rate", { host: n.label, from: n.currency ?? "—", rate: Number((n.rate ?? 0).toPrecision(3)), to: currency })).join(sep) })}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- price table dialog

/** `orig`: the stored entry (its aliases / currency / cache-write price are kept, not edited here). */
type PriceDraft = { model: string; input: string; cachedInput: string; output: string; orig?: UsagePrices["models"][string] };

const MAP_PROBLEM_KEY: Record<MapProblem, MessageKey> = {
  self: "usage.map.problem.self",
  duplicate: "usage.map.problem.duplicate",
  chain: "usage.map.problem.chain",
  priced: "usage.map.problem.priced",
  empty: "usage.map.problem.empty",
  tooMany: "usage.map.problem.tooMany",
};

/** `host`: 「全部主机」 names the one host the table is saved on. */
function PricesDialog({ prices, host, add, usedModels, unpriced, canMap, onClose, onSaved }: { prices: UsagePrices; host?: string; add: string[]; usedModels: string[]; unpriced: string[]; canMap: boolean; onClose(): void; onSaved(p: UsagePrices): void }) {
  const api = useTargetApi();
  const { t } = useI18n();
  const modelName = useModelName();
  const [currency, setCurrency] = useState(prices.currency);
  const [draft, setDraft] = useState<PriceDraft[]>(() => [
    ...Object.entries(prices.models).map(([model, v]) => ({ model, input: String(v.input), cachedInput: v.cachedInput === undefined ? "" : String(v.cachedInput), output: String(v.output), orig: v })),
    ...add.map((model) => ({ model, input: "", cachedInput: "", output: "" })),
  ]);
  const [maps, setMaps] = useState<MapDraft[]>(() => mapDrafts(prices));
  // A half-filled row is flagged only once the owner tries to save.
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A blank row (no price typed) is not saved: it would price the model at 0.
  const kept = useMemo(() => draft.filter((r) => r.model.trim() && (r.input.trim() || r.output.trim() || r.orig)), [draft]);
  const priced = useMemo(() => manualNames(Object.fromEntries(kept.map((r) => [r.model.trim(), { input: 0, output: 0, aliases: r.orig?.aliases }])) as UsagePrices["models"]), [kept]);
  const problems = useMemo(() => (canMap ? mapProblems(maps, priced) : new Map<number, MapProblem>()), [canMap, maps, priced]);
  const suggestions = useMemo(() => mapSuggestions(unpriced, usedModels, prices, maps), [unpriced, usedModels, prices, maps]);
  const setMap = (i: number, key: keyof MapDraft, v: string) => setMaps(maps.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
  // A price row → a 「按另一个模型计价」 row (the owner has no price for it, another model's will do).
  const toMap = (i: number) => {
    setMaps([...maps, { from: draft[i]!.model.trim(), to: "" }]);
    setDraft(draft.filter((_, j) => j !== i));
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const set = (i: number, key: keyof PriceDraft, v: string) => setDraft(draft.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
  // AUD / CNY / USD; a host already set to something else keeps showing it.
  const currencies = [...new Set<string>([...CURRENCIES, currency])];
  const save = async () => {
    const models: UsagePrices["models"] = {};
    for (const r of kept) {
      const { cachedInput: _cached, ...orig } = r.orig ?? {};
      models[r.model.trim()] = { ...orig, input: Number(r.input) || 0, output: Number(r.output) || 0, ...(r.cachedInput ? { cachedInput: Number(r.cachedInput) } : {}) };
    }
    if (problems.size > 0) {
      setTried(true);
      return setError(t("usage.map.fix"));
    }
    try {
      // Without usage-model-map the body has no modelMap: cutex keeps whatever map it has.
      onSaved(await api.putUsagePrices({ currency, models, ...(canMap ? { modelMap: buildModelMap(maps) } : {}) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const cols = "grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_5.5rem_4.5rem] items-center gap-2";
  const mapCols = "grid grid-cols-[minmax(0,1fr)_1rem_minmax(0,1fr)_4.5rem] items-center gap-2";
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40" onMouseDown={onClose}>
      <div className="flex max-h-[85vh] w-[640px] flex-col rounded-2xl border border-border bg-surface p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center">
          <h3 className="font-semibold">{host ? t("usage.all.pricesOn", { host }) : t("usage.prices")}</h3>
          <span className="ml-auto">
            <IconButton label={t("settings.cancel")} onClick={onClose}>
              <X size={15} />
            </IconButton>
          </span>
        </div>
        <p className="mb-4 flex items-center gap-2 text-xs text-subtle">
          <span>{t("usage.pricesUnit")}</span>
          <Select width="w-24" value={currency} options={currencies.map((c) => ({ value: c, label: c }))} onChange={setCurrency} label={t("usage.currency")} />
          <span>{t("usage.pricesHint")}</span>
        </p>
        <div className={`${cols} border-b border-border pb-1.5 text-xs text-subtle`}>
          <span>{t("usage.model")}</span>
          <span>{t("usage.input")}</span>
          <span>{t("usage.cachedRead")}</span>
          <span>{t("usage.output")}</span>
          <span />
        </div>
        <div className="min-h-0 overflow-y-auto">
          <datalist id={`${ID}-models`}>
            {/* The value stays the raw id (prices are keyed by it); the shown name is the hint. */}
            {usedModels.map((m) => (
              <option key={m} value={m} label={modelName(m) === m ? undefined : modelName(m)} />
            ))}
          </datalist>
          {draft.map((r, i) => {
            const provider = modelProvider(r.model);
            return (
              <div key={i} className={`${cols} border-b border-border py-1.5`}>
                <span className="flex min-w-0 items-center gap-2">
                  <ProviderIcon provider={provider} name={r.model || "?"} size={14} />
                  <input className={`${CELL_INPUT} font-mono text-xs`} list={`${ID}-models`} placeholder="model" aria-label={t("usage.model")} value={r.model} onChange={(e) => set(i, "model", e.target.value)} />
                </span>
                <input className={CELL_INPUT} inputMode="decimal" aria-label={t("usage.input")} value={r.input} onChange={(e) => set(i, "input", e.target.value)} />
                <input className={CELL_INPUT} inputMode="decimal" aria-label={t("usage.cachedRead")} placeholder={r.input || "—"} value={r.cachedInput} onChange={(e) => set(i, "cachedInput", e.target.value)} />
                <input className={CELL_INPUT} inputMode="decimal" aria-label={t("usage.output")} value={r.output} onChange={(e) => set(i, "output", e.target.value)} />
                <span className="flex items-center justify-end gap-0.5">
                  {canMap && !r.orig && r.model.trim() && (
                    <IconButton label={t("usage.map.convert")} onClick={() => toMap(i)}>
                      <ArrowRightLeft size={13} />
                    </IconButton>
                  )}
                  <ArmedRemove title={t("usage.removePrice")} onRemove={() => setDraft(draft.filter((_, j) => j !== i))} />
                </span>
              </div>
            );
          })}
          {canMap && (
            <div className="mt-4">
              <div className="text-sm font-medium">{t("usage.map.title")}</div>
              <p className="mb-1.5 text-xs text-subtle">{t("usage.map.hint")}</p>
              <datalist id={`${ID}-map-from`}>
                {suggestions.from.map((m) => (
                  <option key={m} value={m} label={modelName(m) === m ? undefined : modelName(m)} />
                ))}
              </datalist>
              <datalist id={`${ID}-map-to`}>
                {suggestions.to.map((m) => (
                  <option key={m} value={m} label={modelName(m) === m ? undefined : modelName(m)} />
                ))}
              </datalist>
              {maps.length > 0 && (
                <div className={`${mapCols} border-b border-border pb-1.5 text-xs text-subtle`}>
                  <span>{t("usage.map.from")}</span>
                  <span />
                  <span>{t("usage.map.to")}</span>
                  <span />
                </div>
              )}
              {maps.map((r, i) => (
                <div key={i} className="border-b border-border py-1.5">
                  <div className={mapCols}>
                    <span className="flex min-w-0 items-center gap-2">
                      <ProviderIcon provider={modelProvider(r.from)} name={r.from || "?"} size={14} />
                      <input className={`${CELL_INPUT} font-mono text-xs`} list={`${ID}-map-from`} placeholder="model" aria-label={t("usage.map.from")} value={r.from} onChange={(e) => setMap(i, "from", e.target.value)} />
                    </span>
                    <ArrowRight size={13} className="justify-self-center text-subtle" />
                    <span className="flex min-w-0 items-center gap-2">
                      <ProviderIcon provider={modelProvider(r.to)} name={r.to || "?"} size={14} />
                      <input className={`${CELL_INPUT} font-mono text-xs`} list={`${ID}-map-to`} placeholder="model" aria-label={t("usage.map.to")} value={r.to} onChange={(e) => setMap(i, "to", e.target.value)} />
                    </span>
                    <span className="flex justify-end">
                      <ArmedRemove title={t("usage.map.remove")} onRemove={() => setMaps(maps.filter((_, j) => j !== i))} />
                    </span>
                  </div>
                  {problems.get(i) && (tried || problems.get(i) !== "empty") && <div className="mt-1 text-xs text-warn">{t(MAP_PROBLEM_KEY[problems.get(i)!])}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="mt-4 flex items-center gap-2">
          <AddButton onClick={() => setDraft([...draft, { model: "", input: "", cachedInput: "", output: "" }])}>{t("usage.addPrice")}</AddButton>
          {canMap && <AddButton onClick={() => setMaps([...maps, { from: "", to: "" }])}>{t("usage.map.add")}</AddButton>}
          <span className="ml-auto" />
          <Button onClick={onClose}>{t("settings.cancel")}</Button>
          <Button primary onClick={() => void save()}>
            {t("settings.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 额外目录 list (undefined = loading, null = no such route / feature); polls while a source scans. */
function useUsageSources(enabled: boolean) {
  const api = useTargetApi();
  const host = useTargetHostId();
  const [view, setView] = useState<UsageSourcesView | null | undefined>(enabled ? undefined : null);
  const [error, setError] = useState<string | null>(null);
  // Bumped whenever imported rows may have changed (a scan finished, a source changed): the ledger reloads.
  const [refresh, setRefresh] = useState(0);
  const load = useCallback(async () => {
    if (!enabled) return setView(null);
    try {
      setView(await api.usageSources());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api, enabled]);
  useEffect(() => {
    void load();
  }, [load, host]);
  const scanning = anyScanning(view ?? null);
  const wasScanning = useRef(false);
  useEffect(() => {
    if (wasScanning.current && !scanning) setRefresh((n) => n + 1);
    wasScanning.current = scanning;
    if (!scanning) return;
    const timer = setTimeout(() => void load(), SCAN_POLL_MS);
    return () => clearTimeout(timer);
  }, [scanning, view, load]);
  // A create / rescan answers before its background scan may have marked itself: look once more.
  const changed = useCallback(() => {
    setRefresh((n) => n + 1);
    void load();
    setTimeout(() => {
      void load();
      setRefresh((n) => n + 1);
    }, SCAN_POLL_MS);
  }, [load]);
  return { view, error, refresh, changed };
}

/** One host (the Settings host picker's): as before 「全部主机」 existed. */
function OneHostUsage() {
  const loaded = useProfileProviders();
  const providers = loaded ?? null;
  const host = useTargetHostId();
  const hasSources = useTargetFeatures().has(USAGE_SOURCES_FEATURE);
  const known = useApp((s) => hostData(s, host)?.featuresKnown ?? false);
  const sources = useUsageSources(hasSources);
  return (
    <>
      <Quotas providers={providers} settled={loaded !== undefined} />
      <Ledger providers={providers} sources={sources.view} refresh={sources.refresh} />
      <UsageSources view={sources.view} error={sources.error} unsupported={known && !hasSources} onChanged={sources.changed} />
    </>
  );
}

/** 「全部主机」: every included host merged; the edit host (`TargetHostContext`) gets price / source edits. */
function AllHostsUsage({ all }: { all: AllHostsChoice }) {
  const settingsHost = useTargetHostId();
  const focus = useFocusHostId();
  const scope = useHostScope();
  const data = useHostsData(all.hostIds);
  const [chosen, setEditHost] = useState<string | null>(null);
  const editHost = chosen && all.hostIds.includes(chosen) ? chosen : all.hostIds.includes(settingsHost) ? settingsHost : all.hostIds[0]!;
  const targets = useMemo<HostTarget[]>(
    () =>
      all.hostIds.map((id) => {
        const look = scope.host(id);
        return { hostId: id, label: look?.label ?? id, color: look?.color ?? "var(--fg-subtle)", api: daemonApiOf(id, focus), sources: !!data.find((d) => d.hostId === id)?.features.has(USAGE_SOURCES_FEATURE) };
      }),
    [all.hostIds, scope, focus, data],
  );
  const providers = useHostsProfileProviders(targets);
  // Profile names merge across hosts (trimmed, any case); the first host's spelling is shown.
  const canonical = useMemo(() => canonicalNames(targets.flatMap((x) => [...(providers?.get(x.hostId)?.keys() ?? [])])), [targets, providers]);
  // name → profile for avatars / colours of merged series: the first host's profile of that name.
  const merged = useMemo<ProfileProviders>(() => {
    if (!providers) return null;
    const out = new Map<string, ProfileItem>();
    for (const x of targets) for (const [name, p] of providers.get(x.hostId) ?? []) if (!out.has(canonical(name))) out.set(canonical(name), p);
    return out;
  }, [targets, providers, canonical]);
  const colors = useMemo(() => new Map(targets.map((x) => [x.label, x.color])), [targets]);
  const view = useMemo<AllView>(() => ({ targets, primary: settingsHost, excluded: all.excluded, providers, canonical, colors, editHost, setEditHost }), [targets, settingsHost, all.excluded, providers, canonical, colors, editHost]);
  return (
    <AllViewContext.Provider value={view}>
      <HostColors.Provider value={colors}>
        <TargetHostContext.Provider value={editHost}>
          <AllQuotas view={view} />
          <AllHostsEditing providers={merged} view={view} />
        </TargetHostContext.Provider>
      </HostColors.Provider>
    </AllViewContext.Provider>
  );
}

/** Under the edit host's TargetHostContext: the merged ledger, then 额外目录 of the edit host. */
function AllHostsEditing({ providers, view }: { providers: ProfileProviders; view: AllView }) {
  const { t } = useI18n();
  const host = useTargetHostId();
  const hasSources = useTargetFeatures().has(USAGE_SOURCES_FEATURE);
  const known = useApp((s) => hostData(s, host)?.featuresKnown ?? false);
  const sources = useUsageSources(hasSources);
  return (
    <>
      <Ledger providers={providers} sources={sources.view} refresh={sources.refresh} />
      <UsageSources view={sources.view} error={sources.error} unsupported={known && !hasSources} onChanged={sources.changed} host={<EditHostPicker view={view} />} hostHint={t("usage.all.editHint")} />
    </>
  );
}

export function UsagePage() {
  const all = useAllHostsTarget();
  return all ? <AllHostsUsage all={all} /> : <OneHostUsage />;
}
