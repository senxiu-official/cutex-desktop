// 用量 「全部主机」 (Settings → 用量 with every connected host at once): pure merge helpers, unit-tested
// in test/usageMerge.test.ts. Each host's `/v2/usage` and quotas are read separately and merged here,
// in the desktop only (cutex knows nothing about other hosts).
//
// - Profile identity across hosts is the profile NAME, trimmed and case-insensitive (`profileKey`);
//   the shown spelling is the first host's (`canonicalNames`).
// - Rows keep their host (`key.host` = label, `key.hostId`) so the 「主机」 split can still tell hosts
//   apart; the page's own aggregation (chart / table) adds same-named series up.
// - Cost: one display currency. Hosts in another currency are converted with cutex `pricing.exchangeRates`
//   (units per 1 USD); a host whose rate is missing keeps its cost out of every total and is listed in
//   `unconverted` — currencies are never mixed silently.
// - Quotas: one card per profile name; the same account on several hosts shows the freshest observation
//   (gauges are never added up); a different provider under the same name stays a separate card.
import type { ProfileItem, QuotaGauge, UsageAmounts, UsageReport } from "../../../../shared/ipc";
import { latestObservedAt } from "../../lib/quota";

type Row = UsageReport["rows"][number];
type Unpriced = NonNullable<UsageReport["unpricedModels"]>[number];

/** The merged ledger's row key: the host the row came from rides along (the 「主机」 split). */
export type HostRowKey = Row["key"] & { host?: string; hostId?: string };

/** Identity of a profile across hosts: its name, trimmed, ignoring case. */
export function profileKey(name: string): string {
  return name.trim().toLowerCase();
}

/** name → its shown spelling: the first spelling (trimmed) met in `names`, in order. */
export function canonicalNames(names: Iterable<string | null | undefined>): (name: string) => string {
  const seen = new Map<string, string>();
  for (const n of names) if (n && n.trim() && !seen.has(profileKey(n))) seen.set(profileKey(n), n.trim());
  return (name) => seen.get(profileKey(name)) ?? name.trim();
}

/** One host's report for the merge. */
export interface HostReport {
  hostId: string;
  label: string;
  report: UsageReport;
}

/** The display currency of a report (cutex `usage-currency`: `currency`, else the pricing block's). */
export function reportCurrency(report: UsageReport): string | undefined {
  return report.currency ?? report.pricing?.displayCurrency ?? undefined;
}

/**
 * Factor turning an amount in `from` into `to`, from the first rate table that knows both (cutex rates are
 * units per 1 USD, so USD is 1 when a table omits it). null = no table can convert.
 */
export function conversionRate(from: string, to: string, tables: readonly (Readonly<Record<string, number>> | null | undefined)[]): number | null {
  if (from === to) return 1;
  for (const table of tables) {
    if (!table) continue;
    const rate = (c: string) => table[c] ?? (c === "USD" ? 1 : undefined);
    const a = rate(from);
    const b = rate(to);
    if (a && b && a > 0 && b > 0) return b / a;
  }
  return null;
}

/** A host whose API value is in another currency than the merged view. */
export interface CurrencyNote {
  hostId: string;
  label: string;
  currency: string | undefined;
  /** The host's own API value (in `currency`). */
  cost: number;
  /** Factor applied (converted hosts); null = no rate: left out of every cost. */
  rate: number | null;
}

/** An unpriced model of the merged view: tokens added up, with the hosts that reported it. */
export type MergedUnpriced = Unpriced & { hosts: string[] };

export interface MergedUsage {
  report: UsageReport & { unpricedModels: MergedUnpriced[] };
  /** Hosts converted into `report.currency`. */
  converted: CurrencyNote[];
  /** Hosts whose cost could not be converted (excluded from cost totals and rows). */
  unconverted: CurrencyNote[];
}

const AMOUNTS = ["turns", "requests", "input", "cachedInput", "cacheWriteInput", "output", "reasoningOutput", "total"] as const;

function addAmounts(into: UsageAmounts, from: UsageAmounts, rate: number | null): void {
  for (const k of AMOUNTS) into[k] += from[k] ?? 0;
  if (from.estimatedCost !== undefined && rate !== null) into.estimatedCost = (into.estimatedCost ?? 0) + from.estimatedCost * rate;
  if (from.apiEquivalentUsd !== undefined) into.apiEquivalentUsd = (into.apiEquivalentUsd ?? 0) + from.apiEquivalentUsd;
  if (from.unpricedTokens !== undefined) into.unpricedTokens = (into.unpricedTokens ?? 0) + from.unpricedTokens;
  if (from.pricedAs?.length) into.pricedAs = [...new Set([...(into.pricedAs ?? []), ...from.pricedAs])].sort();
}

/**
 * Merge per-host reports of the same query. `currency`: the view's currency (default: the first host's
 * that has one). `canonical`: shown spelling of a profile name (default: first host's spelling).
 */
/*
 * Days: each cutex buckets `key.day` in its own local time zone and its report carries no zone or UTC
 * offset, so same-day rows of hosts in different zones are added although they cover slightly
 * different hours. Not redesigned (2026-10-15 review): the 「全部主机」 hosts note says days are each
 * host's local date. If cutex starts reporting its zone, mark per-day rows approximate when hosts differ.
 */
export function mergeUsageReports(parts: readonly HostReport[], opts: { currency?: string; canonical?: (name: string) => string } = {}): MergedUsage {
  const canonical = opts.canonical ?? canonicalNames(parts.flatMap((p) => p.report.rows.map((r) => r.key.profile)));
  const currencies = parts.map((p) => reportCurrency(p.report));
  const target = opts.currency ?? currencies.find((c) => c !== undefined);
  // Rate tables: the target currency's host first (its owner set those rates), then the rest.
  const tables = [...parts.filter((_, i) => currencies[i] === target), ...parts.filter((_, i) => currencies[i] !== target)].map((p) => p.report.pricing?.exchangeRates);
  const converted: CurrencyNote[] = [];
  const unconverted: CurrencyNote[] = [];
  const rates = parts.map((p, i) => {
    const from = currencies[i];
    if (from === target) return 1;
    const rate = from && target ? conversionRate(from, target, tables) : null;
    const cost = p.report.totals.estimatedCost;
    // A host without any API value has nothing to convert (no note either).
    if (cost !== undefined || p.report.rows.some((r) => r.estimatedCost !== undefined)) (rate === null ? unconverted : converted).push({ hostId: p.hostId, label: p.label, currency: from, cost: cost ?? 0, rate });
    return rate;
  });
  const totals: UsageAmounts = { turns: 0, requests: 0, input: 0, cachedInput: 0, cacheWriteInput: 0, output: 0, reasoningOutput: 0, total: 0 };
  const rows: Row[] = [];
  const unpriced = new Map<string, MergedUnpriced>();
  const warnings: string[] = [];
  let since: string | null = null;
  parts.forEach((p, i) => {
    const rate = rates[i]!;
    addAmounts(totals, p.report.totals, rate);
    for (const r of p.report.rows) {
      const key: HostRowKey = { ...r.key, host: p.label, hostId: p.hostId };
      if (r.key.profile) key.profile = canonical(r.key.profile);
      const row: Row = { ...r, key };
      if (r.estimatedCost !== undefined) {
        if (rate === null) delete row.estimatedCost;
        else row.estimatedCost = r.estimatedCost * rate;
      }
      rows.push(row);
    }
    for (const u of p.report.unpricedModels ?? []) {
      const id = (u.model ?? "").toLowerCase();
      const cur = unpriced.get(id);
      if (!cur) unpriced.set(id, { ...u, hosts: [p.hostId] });
      else {
        cur.requests += u.requests;
        cur.tokens += u.tokens;
        if (!cur.hosts.includes(p.hostId)) cur.hosts.push(p.hostId);
        cur.pricedAs ??= u.pricedAs;
      }
    }
    for (const w of p.report.warnings) warnings.push(`${p.label}: ${w}`);
    const s = p.report.recordingSince;
    if (s && (since === null || s < since)) since = s;
  });
  const first = parts[0]?.report;
  const base = parts.find((_, i) => currencies[i] === target)?.report ?? first;
  return {
    report: {
      from: first?.from ?? "",
      to: first?.to ?? "",
      groupBy: first?.groupBy ?? ["day"],
      totals,
      rows,
      ...(target !== undefined ? { currency: target } : {}),
      recordingSince: since,
      warnings,
      unpricedModels: [...unpriced.values()],
      ...(base?.pricing ? { pricing: base.pricing } : {}),
    },
    converted,
    unconverted,
  };
}

// ---------------------------------------------------------------- per-host queries

/** A `/v2/usage` query (shared/ipc DaemonApi.usage). */
export type UsageQuery = Parameters<import("../../../../shared/ipc").DaemonApi["usage"]>[0];

/**
 * The query one host of the merged view gets. A host without extra usage sources (no
 * `usage-external-sources`) only has cutex rows: no `source` filter / dimension is sent to it (an older
 * cutex may refuse them), and 「仅额外目录」 has nothing to ask it at all (null).
 */
export function hostQuery(query: UsageQuery, sources: boolean): UsageQuery | null {
  if (sources) return query;
  if (query.source && query.source !== "cutex") return null;
  const { source: _source, ...rest } = query;
  return { ...rest, groupBy: query.groupBy.filter((g) => g !== "source") };
}

/** Rows of a host asked without the `source` dimension (see hostQuery): all of them are cutex's own. */
export function asCutexSource(report: UsageReport): UsageReport {
  return { ...report, groupBy: [...report.groupBy, "source"], rows: report.rows.map((r) => ({ ...r, key: { ...r.key, source: "cutex", sourceLabel: null, sourceKind: "cutex", sourceBilling: null } })) };
}

/** A report with nothing in it (a host the query does not apply to). */
export function emptyReport(query: UsageQuery): UsageReport {
  return { from: query.from ?? "", to: query.to ?? "", groupBy: query.groupBy, totals: { turns: 0, requests: 0, input: 0, cachedInput: 0, cacheWriteInput: 0, output: 0, reasoningOutput: 0, total: 0 }, rows: [], recordingSince: null, warnings: [] };
}

// ---------------------------------------------------------------- quotas

/**
 * Which account a profile stands for, as far as the desktop can tell: CLI kind + provider + base URL.
 * Two hosts' profiles of one name with the same signature are the same account (same quota).
 */
export function profileSignature(p: Pick<ProfileItem, "cliKind" | "provider" | "modelProvider" | "baseUrl"> | null | undefined): string | null {
  if (!p) return null;
  const base = (p.baseUrl ?? "").trim().replace(/\/+$/, "").toLowerCase();
  return [p.cliKind, (p.modelProvider ?? p.provider ?? "").toLowerCase(), base].join("|");
}

/** One host's profile and its quota (undefined gauges = not answered yet). */
export interface HostQuota {
  hostId: string;
  label: string;
  name: string;
  /** `profileSignature` of the host's profile (null: unknown, joins the first card of the name). */
  signature: string | null;
  gauges: QuotaGauge[] | undefined;
}

export interface QuotaCard {
  /** React key: the profile key + signature group. */
  key: string;
  /** Shown name (first host's spelling). */
  name: string;
  /** Labels of the hosts that have this profile (this provider), in host order. */
  hosts: string[];
  /** Their ids, same order. */
  hostIds: string[];
  /** Same name, another provider elsewhere: the card's name reads `name · hosts`. */
  split: boolean;
  /** Label of the host whose gauges are shown (the freshest observation); null without gauges. */
  from: string | null;
  fromHostId: string | null;
  gauges: QuotaGauge[];
  /** Every host answered. */
  loaded: boolean;
}

/** One card per profile name (per provider when they differ); `quotas` in display order. */
export function mergeQuotas(quotas: readonly HostQuota[]): QuotaCard[] {
  const canonical = canonicalNames(quotas.map((q) => q.name));
  const groups = new Map<string, HostQuota[][]>();
  for (const q of quotas) {
    const k = profileKey(q.name);
    const list = groups.get(k) ?? [];
    groups.set(k, list);
    const same = q.signature === null ? list[0] : list.find((g) => g.some((x) => x.signature === q.signature) || g.every((x) => x.signature === null));
    if (same) same.push(q);
    else list.push([q]);
  }
  const out: QuotaCard[] = [];
  for (const [k, list] of groups) {
    list.forEach((members, gi) => {
      let best: HostQuota | null = null;
      let bestAt = -Infinity;
      for (const m of members) {
        if (!m.gauges?.length) continue;
        const at = latestObservedAt(m.gauges) ?? Number.NEGATIVE_INFINITY;
        if (best === null || at > bestAt) [best, bestAt] = [m, at];
      }
      const winner = best as HostQuota | null;
      out.push({
        key: `${k}#${gi}`,
        name: canonical(members[0]!.name),
        hosts: [...new Set(members.map((m) => m.label))],
        hostIds: [...new Set(members.map((m) => m.hostId))],
        split: list.length > 1,
        from: winner?.label ?? null,
        fromHostId: winner?.hostId ?? null,
        gauges: winner?.gauges ?? [],
        loaded: members.every((m) => m.gauges !== undefined),
      });
    });
  }
  return out;
}
