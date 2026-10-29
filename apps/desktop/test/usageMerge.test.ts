// 用量 「全部主机」: merging per-host ledgers and quotas (renderer modules/usage/merge.ts) and the
// header picker's host choice (lib/hostPick allHostsChoice).
import { describe, expect, it } from "vitest";
import type { ProfileItem, QuotaGauge, UsageReport } from "../src/shared/ipc";
import { asCutexSource, canonicalNames, conversionRate, emptyReport, hostQuery, mergeQuotas, mergeUsageReports, profileKey, profileSignature, type HostQuota } from "../src/renderer/src/modules/usage/merge";
import { buckets, buildSeries } from "../src/renderer/src/modules/usage/chart";
import { allHostsChoice } from "../src/renderer/src/lib/hostPick";

const amounts = (total: number, cost?: number) => ({ turns: 1, requests: 2, input: total, cachedInput: 0, cacheWriteInput: 0, output: 0, reasoningOutput: 0, total, ...(cost !== undefined ? { estimatedCost: cost } : {}) });
const RATES = { USD: 1, AUD: 1.5, CNY: 7 };
function report(currency: string | undefined, rows: UsageReport["rows"], extra: Partial<UsageReport> = {}): UsageReport {
  const totals = rows.reduce(
    (a, r) => ({ ...a, turns: a.turns + r.turns, requests: a.requests + r.requests, input: a.input + r.input, total: a.total + r.total, ...(r.estimatedCost !== undefined ? { estimatedCost: (a.estimatedCost ?? 0) + r.estimatedCost } : {}) }),
    { ...amounts(0), turns: 0, requests: 0 } as UsageReport["totals"],
  );
  return { from: "2026-10-14", to: "2026-10-15", groupBy: ["day", "profile"], totals, rows, recordingSince: null, warnings: [], ...(currency ? { currency, pricing: { priceSource: "litellm", displayCurrency: currency, exchangeRates: RATES, catalog: null } } : {}), ...extra };
}

describe("usage all hosts: names", () => {
  it("identifies profiles by trimmed, case-insensitive name; the first spelling is shown", () => {
    expect(profileKey("  GLM ")).toBe(profileKey("glm"));
    const canon = canonicalNames(["GLM", null, "glm ", " Omega", "omega"]);
    expect([canon("glm"), canon(" GLM"), canon("OMEGA"), canon("new ")]).toEqual(["GLM", "GLM", "Omega", "new"]);
  });
});

describe("usage all hosts: currency", () => {
  it("converts with units-per-USD rates, USD implied, first table that knows both", () => {
    expect(conversionRate("AUD", "AUD", [])).toBe(1);
    expect(conversionRate("AUD", "USD", [{ AUD: 1.5 }])).toBeCloseTo(1 / 1.5);
    expect(conversionRate("CNY", "AUD", [{ AUD: 1.5 }, RATES])).toBeCloseTo(1.5 / 7);
    expect(conversionRate("EUR", "USD", [RATES, null, undefined])).toBeNull();
  });
});

describe("usage all hosts: merging ledgers", () => {
  const a = report("USD", [
    { key: { day: "2026-10-14", profile: "GLM" }, ...amounts(100, 1) },
    { key: { day: "2026-10-15", profile: "gamma" }, ...amounts(50, 2) },
  ], { recordingSince: "2026-10-01T00:00:00Z", unpricedModels: [{ provider: null, model: "x-pro", requests: 1, tokens: 10 }] });
  const b = report("AUD", [
    { key: { day: "2026-10-15", profile: "glm " }, ...amounts(30, 3) },
    { key: { day: "2026-10-15", profile: "relay" }, ...amounts(20) },
  ], { recordingSince: "2026-09-01T00:00:00Z", unpricedModels: [{ provider: null, model: "X-PRO", requests: 2, tokens: 5 }, { provider: null, model: "y", requests: 1, tokens: 1 }], warnings: ["stale catalog"] });

  it("sums tokens, converts cost to the view currency and keeps each row's host", () => {
    const m = mergeUsageReports([{ hostId: "h1", label: "host-a", report: a }, { hostId: "h2", label: "host-b", report: b }]);
    expect(m.report.currency).toBe("USD");
    expect(m.report.totals.total).toBe(200);
    expect(m.report.totals.turns).toBe(4);
    // 1 + 2 USD, 3 AUD = 2 USD
    expect(m.report.totals.estimatedCost).toBeCloseTo(5);
    expect(m.converted).toEqual([{ hostId: "h2", label: "host-b", currency: "AUD", cost: 3, rate: 1 / 1.5 }]);
    expect(m.unconverted).toEqual([]);
    expect(m.report.rows.map((r) => [r.key.profile, (r.key as { host?: string }).host])).toEqual([
      ["GLM", "host-a"],
      ["gamma", "host-a"],
      ["GLM", "host-b"],
      ["relay", "host-b"],
    ]);
    expect(m.report.rows[2]!.estimatedCost).toBeCloseTo(2);
    expect(m.report.recordingSince).toBe("2026-09-01T00:00:00Z");
    expect(m.report.warnings).toEqual(["host-b: stale catalog"]);
    // Unpriced models merge across hosts (any case) with the hosts that reported them.
    expect(m.report.unpricedModels).toEqual([
      { provider: null, model: "x-pro", requests: 3, tokens: 15, hosts: ["h1", "h2"] },
      { provider: null, model: "y", requests: 1, tokens: 1, hosts: ["h2"] },
    ]);
    // The page's aggregation adds same-named profiles up; the 主机 split keeps hosts apart.
    const bks = buckets(["2026-10-14", "2026-10-15"]);
    expect(buildSeries(m.report, "profile", bks, "tokens")).toEqual({ series: ["GLM", "gamma", "relay"], values: [[100, 30], [0, 50], [0, 20]] });
    expect(buildSeries(m.report, "host", bks, "tokens")).toEqual({ series: ["host-a", "host-b"], values: [[100, 50], [0, 50]] });
  });

  it("uses the requested currency (the Settings host's)", () => {
    const m = mergeUsageReports([{ hostId: "h1", label: "host-a", report: a }, { hostId: "h2", label: "host-b", report: b }], { currency: "AUD" });
    expect(m.report.currency).toBe("AUD");
    expect(m.report.totals.estimatedCost).toBeCloseTo(3 * 1.5 + 3);
    expect(m.report.pricing?.displayCurrency).toBe("AUD");
  });

  it("never mixes currencies: a host without a rate is left out of every cost", () => {
    const noRates = (r: UsageReport): UsageReport => ({ ...r, pricing: { ...r.pricing!, exchangeRates: {} } });
    const m = mergeUsageReports([{ hostId: "h1", label: "host-a", report: noRates(a) }, { hostId: "h2", label: "host-b", report: noRates(b) }]);
    expect(m.report.totals.estimatedCost).toBeCloseTo(3);
    expect(m.unconverted).toEqual([{ hostId: "h2", label: "host-b", currency: "AUD", cost: 3, rate: null }]);
    expect(m.report.rows[2]!.estimatedCost).toBeUndefined();
    // Tokens still count.
    expect(m.report.totals.total).toBe(200);
  });

  it("sums directly when every host shares the currency (also when none has one)", () => {
    const plain = (r: UsageReport): UsageReport => ({ ...r, currency: undefined, pricing: undefined });
    const m = mergeUsageReports([{ hostId: "h1", label: "a", report: plain(a) }, { hostId: "h2", label: "b", report: plain(b) }]);
    expect(m.report.currency).toBeUndefined();
    expect(m.report.totals.estimatedCost).toBeCloseTo(6);
    expect(m.unconverted).toEqual([]);
  });

  it("asks hosts without extra usage sources only for cutex rows", () => {
    const q = { from: "2026-10-14", to: "2026-10-15", groupBy: ["day" as const, "source" as const], source: "cutex" };
    expect(hostQuery(q, true)).toBe(q);
    expect(hostQuery(q, false)).toEqual({ from: "2026-10-14", to: "2026-10-15", groupBy: ["day"] });
    expect(hostQuery({ ...q, source: "external" }, false)).toBeNull();
    expect(hostQuery({ ...q, source: "claude-code" }, false)).toBeNull();
    const tagged = asCutexSource(report("USD", [{ key: { day: "2026-10-14" }, ...amounts(5) }]));
    expect(tagged.groupBy).toEqual(["day", "profile", "source"]);
    expect(tagged.rows[0]!.key).toMatchObject({ source: "cutex", sourceKind: "cutex" });
    expect(emptyReport(q)).toMatchObject({ rows: [], totals: { total: 0 }, groupBy: ["day", "source"] });
  });
});

describe("usage all hosts: quotas", () => {
  const g = (id: string, observedAt: number | null, remainingPercent = 50): QuotaGauge => ({ id, label: id, kind: "window", remainingPercent, balance: null, resetAt: null, windowLabel: "5h", observedAt, stale: false });
  const q = (hostId: string, name: string, gauges: QuotaGauge[] | undefined, signature: string | null = "codex|openai|"): HostQuota => ({ hostId, label: hostId.toUpperCase(), name, signature, gauges });

  it("one card per name; the freshest observation wins, gauges are not added up", () => {
    const cards = mergeQuotas([q("a", "gamma", [g("p", 100, 80)]), q("a", "GLM", []), q("b", "Gamma", [g("p", 200, 40)]), q("b", "relay", [g("bal", null)])]);
    expect(cards.map((c) => [c.name, c.hosts, c.from, c.gauges.map((x) => x.remainingPercent), c.split])).toEqual([
      ["gamma", ["A", "B"], "B", [40], false],
      ["GLM", ["A"], null, [], false],
      ["relay", ["B"], "B", [50], false],
    ]);
    expect(cards[0]!.fromHostId).toBe("b");
    expect(cards.every((c) => c.loaded)).toBe(true);
  });

  it("a host with gauges beats one without; unanswered hosts keep the card loading", () => {
    const cards = mergeQuotas([q("a", "gamma", []), q("b", "gamma", [g("p", null)]), q("c", "gamma", undefined)]);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.from).toBe("B");
    expect(cards[0]!.loaded).toBe(false);
  });

  it("another provider under the same name stays a separate card", () => {
    const cards = mergeQuotas([q("a", "omega", [g("p", 1)], "codex|deepseek|https://api.deepseek.com"), q("b", "omega", [g("p", 2)], "codex|moonshot|https://api.moonshot.ai"), q("c", "omega", [g("p", 3)], null)]);
    expect(cards.map((c) => [c.hosts, c.split, c.from])).toEqual([
      [["A", "C"], true, "C"],
      [["B"], true, "B"],
    ]);
  });

  it("signs a profile by CLI kind, provider and base URL", () => {
    const p = { cliKind: "codex", provider: null, modelProvider: "DeepSeek", baseUrl: "https://api.deepseek.com/" };
    expect(profileSignature(p)).toBe(profileSignature({ ...p, baseUrl: "https://API.deepseek.com" }));
    expect(profileSignature(p)).not.toBe(profileSignature({ ...p, baseUrl: "https://relay.example" }));
    expect(profileSignature(null)).toBeNull();
  });
});

describe("usage all hosts: the header choice", () => {
  const online = { status: "online" } as const;
  const hosts = [
    { id: "local", label: "host-a", indicator: online },
    { id: "t", label: "host-b", indicator: online },
    { id: "old", label: "old-box", indicator: online },
    { id: "new", label: "new-box", indicator: online },
    { id: "off", label: "alpha", indicator: { status: "offline" } },
  ] as unknown as Parameters<typeof allHostsChoice>[0];
  const features: Record<string, ReadonlySet<string> | null> = { local: new Set(["usage-ledger"]), t: new Set(["usage-ledger", "x"]), old: new Set(), new: null };

  it("offers every online host with the capability, and says why the rest are left out", () => {
    expect(allHostsChoice(hosts, (id) => features[id] ?? null, "usage-ledger")).toEqual({
      hostIds: ["local", "t"],
      excluded: [
        { hostId: "old", label: "old-box", reason: "unsupported" },
        { hostId: "new", label: "new-box", reason: "checking" },
        { hostId: "off", label: "alpha", reason: "offline" },
      ],
    });
  });

  it("is not offered with fewer than two such hosts", () => {
    expect(allHostsChoice(hosts.slice(0, 1), (id) => features[id] ?? null, "usage-ledger")).toBeNull();
    expect(allHostsChoice(hosts, (id) => (id === "local" ? features.local! : null), "usage-ledger")).toBeNull();
  });
});


describe("usage linked accounts", () => {
  const profile = (name: string, accountKey?: string, secretId = "1234abcd", id = name): ProfileItem => ({ id, name, cliKind: "codex", provider: "openai", ...(accountKey ? { link: { accountKey, secretId, basis: "chatgpt-user", source: "auto" } } : {}) } as ProfileItem);
  const gauge = (observedAt: number, remainingPercent: number): QuotaGauge => ({ id: "window", label: "window", kind: "window", observedAt, remainingPercent, balance: null, resetAt: null, windowLabel: "5h", stale: false });
  const quota = (hostId: string, name: string, accountKey?: string, secretId = "1234abcd", observedAt = 1): HostQuota => ({ hostId, label: hostId.toUpperCase(), name, accountKey, secretId, signature: "codex|openai|", gauges: [gauge(observedAt, 90 - observedAt)] });
  const part = (hostId: string, p: ProfileItem | null, name = p?.name ?? "shared", total = 10) => ({ hostId, label: hostId.toUpperCase(), report: report("USD", [{ key: { day: "2026-10-14", profile: name, ...(p ? { profileId: p.id } : {}) }, ...amounts(total, 1) }]), profiles: p ? new Map([[p.name, p]]) : null });
  const keyA = "aaaaaaaaaaaaaaaaaaaaaa", keyB = "bbbbbbbbbbbbbbbbbbbbbb";

  it("merges different names for one account and selects the latest whole quota observation", () => {
    const cards = mergeQuotas([quota("a", "work", keyA), quota("b", "personal", keyA, "1234abcd", 4)]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ name: "work", from: "B", fromHostId: "b", fromName: "personal", observedAt: 4, linkedHosts: ["A", "B"] });
    expect(cards[0]!.gauges.map((g) => g.remainingPercent)).toEqual([86]);
    const merged = mergeUsageReports([part("a", profile("work", keyA)), part("b", profile("personal", keyA), "personal", 20)]).report;
    expect(merged.totals.total).toBe(30);
    const days = buckets(["2026-10-14"]);
    expect(buildSeries(merged, "profile", days, "tokens").values).toEqual([[30]]);
    expect(buildSeries(merged, "host", days, "tokens")).toEqual({ series: ["B", "A"], values: [[20], [10]] });
    expect(merged.rows.map((r) => r.key.profile)).toEqual(["work", "work"]);
  });

  it("separates the same name with conflicting known accounts or salts", () => {
    for (const [key, salt] of [[keyB, "1234abcd"], [keyA, "9876abcd"]]) {
      const cards = mergeQuotas([quota("a", "shared", keyA), quota("b", "shared", key, salt)]);
      expect(cards).toHaveLength(2);
      expect(cards.every((card) => card.split)).toBe(true);
      const merged = mergeUsageReports([part("a", profile("shared", keyA)), part("b", profile("shared", key, salt))]).report;
      expect(buildSeries(merged, "profile", buckets(["2026-10-14"]), "tokens").values).toEqual([[10], [10]]);
    }
  });

  it("never lets a legacy name bridge two known accounts, regardless of input order", () => {
    const entries = [quota("a", "shared", keyA), quota("b", "shared", keyB), quota("old", "shared")];
    for (const order of [entries, [entries[2]!, entries[0]!, entries[1]!], [...entries].reverse()]) {
      const cards = mergeQuotas(order);
      expect(cards).toHaveLength(3);
      expect(cards.every((card) => card.hostIds.length === 1)).toBe(true);
    }
    const merged = mergeUsageReports([part("old", null), part("a", profile("shared", keyA)), part("b", profile("shared", keyB))]).report;
    expect(buildSeries(merged, "profile", buckets(["2026-10-14"]), "tokens").series).toHaveLength(3);
  });

  it("retains name fallback for old hosts when only one compatible linked account exists", () => {
    const cards = mergeQuotas([quota("old", "SHARED"), quota("a", "shared", keyA)]);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.linkedHosts).toEqual(["A"]);
    const merged = mergeUsageReports([part("old", null), part("a", profile("shared", keyA))]).report;
    expect(buildSeries(merged, "profile", buckets(["2026-10-14"]), "tokens").values).toEqual([[20]]);
  });

  it("does not inherit a replacement profile account when an old row has a different profile ID", () => {
    const current = profile("shared", keyA, "1234abcd", "new-id");
    const old = part("a", current);
    old.report.rows[0]!.key.profileId = "old-id";
    const merged = mergeUsageReports([old, part("b", profile("shared", keyA))]).report;
    expect(buildSeries(merged, "profile", buckets(["2026-10-14"]), "tokens").series).toHaveLength(2);
  });

  it("keeps display-name collisions distinct in chart identities", () => {
    const merged = mergeUsageReports([part("a", profile("same", keyA)), part("b", profile("same", keyB)), part("c", profile("same · A"))]).report;
    expect(merged.rows.map((r) => r.key.profile)).toEqual(["same · A", "same · B", "same · A"]);
    expect(buildSeries(merged, "profile", buckets(["2026-10-14"]), "tokens").series).toHaveLength(3);
  });

  it("keeps quota signature fallback and ledger name fallback different for legacy hosts", () => {
    const cards = mergeQuotas([quota("a", "old"), { ...quota("b", "old"), signature: "claude|anthropic|" }]);
    expect(cards).toHaveLength(2);
    const merged = mergeUsageReports([part("a", profile("old")), part("b", { ...profile("old"), cliKind: "claude" } as ProfileItem)]).report;
    expect(buildSeries(merged, "profile", buckets(["2026-10-14"]), "tokens").values).toEqual([[20]]);
  });
});
