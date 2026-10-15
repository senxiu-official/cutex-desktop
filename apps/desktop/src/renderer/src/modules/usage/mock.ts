// Browser-preview data for the token ledger and prices (Settings → 用量; dev/mockTypes.ts).
// 「全部主机」 (`?mh=2`: workstation connects too): workstation has its own ledger in AUD (gamma shared
// with this machine, relay only there, a model unpriced on both), its own price table, no extra
// directories, and a fresher gamma quota. `?usagenorate`: no exchange rates anywhere (the AUD host's
// API value cannot be converted).
import type { ModuleMock } from "../../dev/mockTypes";
import type { DesktopApi, QuotaGauge, UsageReport, UsagePrices } from "../../../../shared/ipc";
import { USAGE_SOURCE_KIND_DEFAULTS, type UsageSource, type UsageSourceResult } from "../../../../shared/usageSources";

// Price table (usage-model-map: a relay's renamed Gemini is priced as the library's gemini-3.8-flash;
// "gemini-3.8-pro-tiere" stays unpriced so 「补上价格」 can offer a mapping).
let prices: UsagePrices = {
  currency: "USD",
  models: { "deepseek-v4-flash": { input: 0.27, cachedInput: 0.07, output: 1.1 }, "glm-5.3": { input: 0.6, output: 2.2 } },
  modelMap: { "gemini-3.8-flash-tiere": "gemini-3.8-flash" },
};
/** Models the mock "library" prices (stands in for litellm / models.dev). */
const LIBRARY = new Set(["gpt-5.5", "deepseek-v4-pro", "claude-opus-5-5", "gemini-3.8-flash"]);
const mappedTo = (table: UsagePrices, model: string) => Object.entries(table.modelMap ?? {}).find(([from]) => from.toLowerCase() === model.toLowerCase())?.[1];
const hasPrice = (table: UsagePrices, model: string) => LIBRARY.has(model.toLowerCase()) || Object.keys(table.models).some((k) => k.toLowerCase() === model.toLowerCase());
const NO_RATES = typeof location !== "undefined" && new URLSearchParams(location.search).has("usagenorate");
/** cutex `pricing` block (rates: units per 1 USD). */
const pricing = (displayCurrency: string): UsageReport["pricing"] => ({ priceSource: "litellm", displayCurrency, exchangeRates: NO_RATES ? {} : { USD: 1, AUD: 1.52, CNY: 7.12 }, catalog: { source: "litellm", url: "https://example.invalid/prices.json", fetchedAt: "2026-10-14T21:00:00Z", checkedAt: "2026-10-15T03:00:00Z", lastError: null, modelCount: 2140 } });

/** One agent of a mock ledger (`source`: an extra usage source's run). */
type MockAgent = { agent: string; agentName: string; profile: string; model: string; project: string; projectName: string; source?: UsageSource };

// usage-external-sources: a Claude Code directory and ZCode (usage-source-zcode) already imported; ~/.codex offered for a new one.
const HOME = "C:\\Users\\owner";
const sources: UsageSource[] = [
  { id: "claude-code", kind: "claude-code", path: `${HOME}\\.claude`, label: "Claude Code", billing: "subscription", enabled: true, supported: true, status: { lastScanAt: new Date(Date.now() - 4 * 60_000).toISOString(), lastScanMs: 840, files: 37, rows: 1204, lastRows: 12, errors: 0, lastError: null, scanning: false } },
  // ZCode: one database (cli/db/db.sqlite), so files = 1; no working directory, so one agent "ZCode" without a project.
  { id: "zcode", kind: "zcode", path: `${HOME}\\.zcode`, label: "ZCode", billing: "subscription", enabled: true, supported: true, status: { lastScanAt: new Date(Date.now() - 2 * 60_000).toISOString(), lastScanMs: 35, files: 1, rows: 2542, lastRows: 6, errors: 0, lastError: null, scanning: false } },
];
const scanDone = new Map<string, number>();
const refuse = (code: string, message: string): UsageSourceResult => ({ ok: false, error: { code, message } });
function current(s: UsageSource): UsageSource {
  const until = scanDone.get(s.id);
  if (until !== undefined && Date.now() >= until) {
    scanDone.delete(s.id);
    s.status = { ...s.status, scanning: false, lastScanAt: new Date().toISOString(), files: s.status.files || 12, rows: s.status.rows || 318, lastRows: 0 };
  }
  return s;
}
function startScan(s: UsageSource) {
  s.status = { ...s.status, scanning: true };
  scanDone.set(s.id, Date.now() + 4000);
}

/** This machine's agents (extra sources' runs included while imported). */
function localAgents(): MockAgent[] {
  return [
    { agent: "eva", agentName: "Eva", profile: "gamma", model: "gpt-5.5", project: "desktop", projectName: "cutex-desktop" },
    { agent: "alden", agentName: "Alden", profile: "omega", model: "deepseek-v4-flash", project: "desktop", projectName: "cutex-desktop" },
    { agent: "mika", agentName: "Mika", profile: "GLM", model: "glm-5.3", project: "desktop", projectName: "cutex-desktop" },
    // Same model, other spelling (a relay reports it upper-case): one row once a display-name rule maps both.
    { agent: "ayumi", agentName: "Ayumi", profile: "GLM", model: "GLM-5.3", project: "desktop", projectName: "cutex-desktop" },
    { agent: "wave", agentName: "Wave-Director", profile: "omega", model: "deepseek-v4-pro", project: "waveline", projectName: "waveline" },
    { agent: "relay", agentName: "Relay", profile: "omega", model: "gemini-3.8-flash-tiere", project: "waveline", projectName: "waveline" },
    { agent: "relay-pro", agentName: "Relay Pro", profile: "omega", model: "gemini-3.8-pro-tiere", project: "waveline", projectName: "waveline" },
    // Extra usage sources: runs outside cutex (no profile).
    ...sources
      .map(current)
      .filter((s) => s.status.rows > 0)
      .map((s) =>
        s.kind === "zcode"
          ? { agent: `ext:${s.id}:zcode`, agentName: "ZCode", profile: null as unknown as string, model: "GLM-5.3", project: null as unknown as string, projectName: null as unknown as string, source: s }
          : { agent: `ext:${s.id}`, agentName: `${s.label} · cutex-desktop`, profile: null as unknown as string, model: s.kind === "codex" ? "gpt-5.5" : "claude-opus-5-5", project: `ext:${s.id}:cutex-desktop`, projectName: "cutex-desktop", source: s },
      ),
  ];
}

/** workstation (`?mh`): gamma shared with this machine, relay only here (one model unpriced on both hosts). */
const WORKSTATION_AGENTS: MockAgent[] = [
  { agent: "kks-lead", agentName: "KKS-Director", profile: "gamma", model: "gpt-5.5", project: "kks", projectName: "kks" },
  { agent: "kks-eval", agentName: "Evaluator", profile: "relay", model: "gemini-3.8-pro-tiere", project: "kks", projectName: "kks" },
  { agent: "ops", agentName: "Ops", profile: "relay", model: "claude-opus-5-5", project: null as unknown as string, projectName: null as unknown as string },
];
/** workstation's own price table (AUD). */
let remotePrices: UsagePrices = { currency: "AUD", models: { "gpt-5.5": { input: 1.9, cachedInput: 0.19, output: 15.2 } }, modelMap: {} };

/** A synthetic ledger: agents across profiles, deterministic per day; `factor` scales the API value (currency). */
async function ledger({ from, to, groupBy, source }: Parameters<DesktopApi["usage"]>[0], world: { agents: MockAgent[]; table: UsagePrices; currency: string; factor: number; since?: string }): Promise<UsageReport> {
  // Synthetic ledger: a few agents across three profiles, deterministic per day.
  const days: string[] = [];
  for (let d = new Date(`${from}T00:00:00`); d <= new Date(`${to}T00:00:00`); d.setDate(d.getDate() + 1)) {
    days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  const agents = world.agents.filter((a) => {
    const ext = a.source ?? null;
    return !source || (source === "cutex" ? !ext : source === "external" ? !!ext : ext?.id === source);
  });
  const rows = new Map<string, { key: Record<string, string>; turns: number; requests: number; input: number; cachedInput: number; cacheWriteInput: number; output: number; reasoningOutput: number; total: number; estimatedCost: number; pricedAs?: string[] }>();
  const unpriced = new Map<string, { provider: string | null; model: string; requests: number; tokens: number; pricedAs?: string }>();
  const allPricedAs = new Set<string>();
  days.forEach((day, di) => {
    agents.forEach((a, ai) => {
      const seed = (di * 7 + ai * 13) % 11;
      if (seed < 3) return;
      const input = seed * 41_000 + ai * 9_000;
      const output = Math.round(input * 0.12);
      const key: Record<string, string> = {};
      for (const g of groupBy) {
        if (g === "day") key.day = day;
        if (g === "profile") key.profile = a.profile;
        if (g === "model") key.model = a.model;
        if (g === "agent") Object.assign(key, { agent: a.agent, agentName: a.agentName });
        if (g === "project") Object.assign(key, { project: a.project, projectName: a.projectName });
        if (g === "source") {
          const ext = a.source ?? null;
          Object.assign(key, ext ? { source: ext.id, sourceLabel: ext.label, sourceKind: ext.kind, sourceBilling: ext.billing } : { source: "cutex", sourceLabel: null, sourceKind: "cutex", sourceBilling: null });
        }
      }
      const id = JSON.stringify(key);
      const row = rows.get(id) ?? { key, turns: 0, requests: 0, input: 0, cachedInput: 0, cacheWriteInput: 0, output: 0, reasoningOutput: 0, total: 0, estimatedCost: 0 };
      row.turns += seed;
      row.requests += seed * 4;
      row.input += input;
      row.cachedInput += Math.round(input * 0.6);
      row.output += output;
      row.reasoningOutput += Math.round(output * 0.4);
      row.total += input + output;
      const to = mappedTo(world.table, a.model);
      if (to) {
        row.pricedAs = [...new Set([...(row.pricedAs ?? []), to])];
        allPricedAs.add(to);
      }
      if (hasPrice(world.table, to ?? a.model)) row.estimatedCost += ((input * 0.3 + output * 1.2) / 1e6) * world.factor;
      else {
        const u = unpriced.get(a.model) ?? { provider: null, model: a.model, requests: 0, tokens: 0, ...(to ? { pricedAs: to } : {}) };
        u.requests += seed * 4;
        u.tokens += input + output;
        unpriced.set(a.model, u);
      }
      rows.set(id, row);
    });
  });
  const list = [...rows.values()];
  const sum = (k: "turns" | "requests" | "input" | "cachedInput" | "cacheWriteInput" | "output" | "reasoningOutput" | "total" | "estimatedCost") => list.reduce((a, r) => a + r[k], 0);
  return {
    from, to, groupBy, currency: world.currency, pricing: pricing(world.currency), recordingSince: world.since ?? "2026-09-20T08:00:00Z", warnings: [],
    totals: { turns: sum("turns"), requests: sum("requests"), input: sum("input"), cachedInput: sum("cachedInput"), cacheWriteInput: 0, output: sum("output"), reasoningOutput: sum("reasoningOutput"), total: sum("total"), estimatedCost: sum("estimatedCost"), apiEquivalentUsd: sum("estimatedCost") / world.factor, ...(allPricedAs.size ? { pricedAs: [...allPricedAs].sort() } : {}) },
    rows: list,
    unpricedModels: [...unpriced.values()],
  } as never;
}

const quotaGauge = (id: string, label: string, g: Partial<QuotaGauge>): QuotaGauge => ({ id, label, kind: "window", remainingPercent: null, balance: null, resetAt: null, windowLabel: null, observedAt: Date.now() / 1000, stale: false, ...g });
/** workstation's quota: gamma read just now (fresher than this machine's), relay a balance. */
const REMOTE_QUOTA: Record<string, QuotaGauge[]> = {
  gamma: [
    quotaGauge("codex-primary", "7d", { windowLabel: "7d", remainingPercent: 71, resetAt: Date.now() / 1000 + 43 * 3600, observedAt: Date.now() / 1000 - 40 }),
    quotaGauge("codex-secondary", "5h", { windowLabel: "5h", remainingPercent: 88, resetAt: Date.now() / 1000 + 2 * 3600, observedAt: Date.now() / 1000 - 40 }),
  ],
  relay: [quotaGauge("primary", "Balance", { kind: "balance", balance: "A$42.10" })],
};

export const mock: ModuleMock = {
  api: () => ({
    usage: (query) => ledger(query, { agents: localAgents(), table: prices, currency: "USD", factor: 1 }),
    async usagePrices() {
      return structuredClone(prices);
    },
    async putUsagePrices(next) {
      // Like cutex: a body without modelMap keeps the stored map.
      prices = { ...structuredClone(next), modelMap: next.modelMap ?? prices.modelMap };
      return structuredClone(prices);
    },
    async usageSources() {
      return {
        sources: sources.map(current).map((s) => structuredClone(s)),
        defaults: [
          { kind: "claude-code", path: `${HOME}\\.claude`, exists: true },
          { kind: "codex", path: `${HOME}\\.codex`, exists: true },
          { kind: "zcode", path: `${HOME}\\.zcode`, exists: true },
        ],
        kinds: ["claude-code", "codex", "zcode"],
        billing: ["subscription", "api"],
        scanIntervalSecs: 300,
      };
    },
    async addUsageSource(body) {
      const path = body.path.trim().replace(/[\\/]+$/, "");
      if (/[\\/]\.cutex([\\/]|$)/i.test(path)) return refuse("usage_source_overlaps_cutex", "this directory holds (or is inside) runs cutex already records; adding it would count them twice");
      if (sources.some((s) => s.path.toLowerCase() === path.toLowerCase())) return refuse("usage_source_overlaps_source", "this directory overlaps another usage source");
      let id: string = body.kind;
      for (let n = 2; sources.some((s) => s.id === id); n++) id = `${body.kind}-${n}`;
      const s: UsageSource = { id, kind: body.kind, path, label: body.label?.trim() || USAGE_SOURCE_KIND_DEFAULTS[body.kind].label, billing: body.billing ?? "subscription", enabled: body.enabled ?? true, supported: true, status: { lastScanAt: null, files: 0, rows: 0, errors: 0, scanning: false } };
      sources.push(s);
      if (s.enabled) startScan(s);
      return { ok: true, source: structuredClone(s) };
    },
    async patchUsageSource(id, patch) {
      const s = sources.find((x) => x.id === id);
      if (!s) return refuse("usage_source_not_found", "no usage source has this id");
      Object.assign(s, patch);
      if (s.enabled && (patch.enabled || patch.path)) startScan(s);
      return { ok: true, source: structuredClone(s) };
    },
    async deleteUsageSource(id, purge) {
      const i = sources.findIndex((x) => x.id === id);
      if (i < 0) return refuse("usage_source_not_found", "no usage source has this id") as never;
      sources.splice(i, 1);
      return { ok: true, purged: purge };
    },
    async rescanUsageSource(id) {
      const s = sources.find((x) => x.id === id);
      if (!s) return refuse("usage_source_not_found", "no usage source has this id");
      if (!s.enabled) return refuse("usage_source_disabled", "this usage source is disabled");
      startScan(s);
      return { ok: true, source: structuredClone(s) };
    },
  }),
  // workstation (`?mh`): its own ledger / prices / quota, no extra directories yet.
  remote: () => ({
    usage: (query) => ledger(query, { agents: WORKSTATION_AGENTS, table: remotePrices, currency: "AUD", factor: 1.52, since: "2026-10-02T01:00:00Z" }),
    async usagePrices() {
      return structuredClone(remotePrices);
    },
    async putUsagePrices(next) {
      remotePrices = { ...structuredClone(next), modelMap: next.modelMap ?? remotePrices.modelMap };
      return structuredClone(remotePrices);
    },
    async usageSources() {
      return { sources: [], defaults: [{ kind: "claude-code", path: "/home/alex/.claude", exists: true }], kinds: ["claude-code", "codex"], billing: ["subscription", "api"], scanIntervalSecs: 300 };
    },
    async profileQuota(profile) {
      return structuredClone(REMOTE_QUOTA[profile] ?? []);
    },
  }),
  features: { base: ["usage-ledger"], new: ["usage-external-sources", "usage-model-map", "usage-source-zcode"] },
};
