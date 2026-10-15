// API-key provider presets (cutex `GET /v2/profile-presets`, feature profile-create) and what a base
// URL means against them: the provider's own API ("official") or anything else ("custom": third-party
// relays, self-hosted servers). Decided by the URL's host, never by the provider name: a profile
// whose provider is called "GLM" but points at a relay is custom. (cutex's `providerFamily` can't tell
// either: an unknown host falls back to the provider id, so that relay is family "zhipu" there.)
// Pure (no React / bridge) so it is unit-testable.
import type { ProfilePreset } from "../../../shared/ipc";

const preset = (id: string, label: string, providerId: string, baseUrl: string | null, family: string | null, familyLabel: string | null, aliases: string[] = [], defaultModel: string | null = null): ProfilePreset => ({
  id,
  aliases,
  label,
  providerId,
  baseUrl,
  baseUrlRequired: baseUrl === null,
  defaultModel,
  providerFamily: family,
  providerFamilyLabel: familyLabel,
});

/**
 * cutex's list (src/profiles/providers.rs) for a host that doesn't answer `GET /v2/profile-presets`,
 * i.e. an OLDER cutex: it mirrors that release's presets (and its zai / zhipu URLs), not the current
 * ones, because the create request only sends the preset id for an official URL. No `autoQuota`:
 * older cutex didn't say (the form then says nothing about quota).
 */
export const FALLBACK_PRESETS: readonly ProfilePreset[] = [
  preset("deepseek", "DeepSeek", "deepseek", "https://api.deepseek.com/", "deepseek", "DeepSeek", [], "deepseek-v4-flash"),
  preset("zai", "Z.ai (GLM Coding Plan)", "zai", "https://api.z.ai/api/coding/paas/v4", "zhipu", "Zhipu GLM (Z.ai / BigModel)", ["glm", "z.ai"]),
  preset("zhipu", "Zhipu BigModel (GLM Coding Plan)", "zhipu", "https://open.bigmodel.cn/api/coding/paas/v4", "zhipu", "Zhipu GLM (Z.ai / BigModel)", ["bigmodel"]),
  preset("moonshot", "Moonshot (Kimi)", "moonshot", "https://api.moonshot.ai/v1", "moonshot", "Moonshot (Kimi)", ["kimi"]),
  preset("openrouter", "OpenRouter", "openrouter", "https://openrouter.ai/api/v1", "openrouter", "OpenRouter"),
  preset("openai", "OpenAI API", "openai-api", "https://api.openai.com/v1", "openai-api", "OpenAI API"),
  preset("custom", "Custom (OpenAI Responses compatible)", "custom", null, null, null),
];

/** cutex's answer, item by item (malformed items dropped); null when nothing usable came back. */
export function presetsOf(raw: unknown): ProfilePreset[] | null {
  if (!Array.isArray(raw)) return null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const out: ProfilePreset[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    const id = str(item?.id);
    if (!id) continue;
    const baseUrl = str(item.baseUrl);
    out.push({
      id,
      aliases: Array.isArray(item.aliases) ? item.aliases.filter((a): a is string => typeof a === "string") : [],
      label: str(item.label) ?? id,
      providerId: str(item.providerId) ?? id,
      baseUrl,
      baseUrlRequired: item.baseUrlRequired === true || baseUrl === null,
      defaultModel: str(item.defaultModel),
      providerFamily: str(item.providerFamily),
      providerFamilyLabel: str(item.providerFamilyLabel),
      ...(typeof item.autoQuota === "boolean" ? { autoQuota: item.autoQuota } : {}),
      ...(item.quotaReader === null || typeof item.quotaReader === "string" ? { quotaReader: str(item.quotaReader) } : {}),
      ...(typeof item.modelCatalog === "boolean" ? { modelCatalog: item.modelCatalog } : {}),
      ...(item.webSearch === null || typeof item.webSearch === "string" ? { webSearch: str(item.webSearch) } : {}),
    });
  }
  return out.length ? out : null;
}

/** Presets with an official URL, in cutex's order (the create form's provider select; 自定义 comes last). */
export function officialPresets(presets: readonly ProfilePreset[]): ProfilePreset[] {
  return presets.filter((p) => p.baseUrl && !p.baseUrlRequired);
}

/**
 * Relay presets (cutex feature profile-web-search: `gemini`): no official URL (`baseUrlRequired`) but more than a bare
 * provider entry — cutex writes model-family config with it (Gemini: Codex's built-in web search
 * off). Listed between the official providers and 自定义; `custom` itself is 自定义.
 */
export function relayPresets(presets: readonly ProfilePreset[]): ProfilePreset[] {
  return presets.filter((p) => !p.baseUrl && p.baseUrlRequired && p.id.toLowerCase() !== "custom");
}

/** A preset by id or alias (case-insensitive), like cutex's `find_preset`. */
export function presetById(id: string | null | undefined, presets: readonly ProfilePreset[]): ProfilePreset | null {
  const key = id?.trim().toLowerCase();
  if (!key) return null;
  return presets.find((p) => p.id.toLowerCase() === key || p.aliases.some((a) => a.toLowerCase() === key)) ?? null;
}

/**
 * Official endpoints cutex has no preset id of their own for. `region` marks one worth offering as a
 * one-click alternative (Moonshot's China endpoint); the rest are equivalent spellings.
 */
const ALTERNATES: readonly { preset: string; url: string }[] = [
  { preset: "deepseek", url: "https://api.deepseek.com/v1" },
  { preset: "moonshot", url: "https://api.moonshot.cn/v1" },
];

/** Where an official host serves (shown next to it so 国内 / 海外 endpoints are told apart). */
const REGIONS: Record<string, "cn" | "intl"> = {
  "api.moonshot.cn": "cn",
  "api.moonshot.ai": "intl",
  "open.bigmodel.cn": "cn",
  "api.z.ai": "intl",
  "api.minimaxi.com": "cn",
  "api.minimax.io": "intl",
};

/** Provider domains (cutex providers.rs `family_for_host`): any host under them is the provider's own. */
const OFFICIAL_DOMAINS: readonly [string, string][] = [
  ["deepseek.com", "deepseek"],
  ["z.ai", "zhipu"],
  ["bigmodel.cn", "zhipu"],
  ["moonshot.ai", "moonshot"],
  ["moonshot.cn", "moonshot"],
  ["openrouter.ai", "openrouter"],
  ["openai.com", "openai-api"],
  ["minimax.io", "minimax"],
  ["minimaxi.com", "minimax"],
  ["x.ai", "xai"],
];

const HTTP_URL = /^https?:\/\/[^\s/]+/i;

/** The (trimmed) input looks like an http(s) URL — the check cutex makes again. */
export function validBaseUrl(url: string | null | undefined): boolean {
  return !!url && HTTP_URL.test(url.trim());
}

function parse(url: string | null | undefined): URL | null {
  const u = url?.trim();
  if (!u || !HTTP_URL.test(u)) return null;
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

/** Lowercased host name of an http(s) URL (no port), or null. */
export function urlHost(url: string | null | undefined): string | null {
  return parse(url)?.hostname.replace(/\.$/, "") || null;
}

/** Same endpoint: scheme, host and port, path without trailing slashes, query. */
export function sameUrl(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  const key = (u: URL) => `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  return key(x) === key(y);
}

/** Every official endpoint of a preset: its own base URL, then the known alternates. */
export function officialUrls(p: ProfilePreset): string[] {
  const ids = new Set([p.id, ...p.aliases].map((x) => x.toLowerCase()));
  return [...(p.baseUrl ? [p.baseUrl] : []), ...ALTERNATES.filter((a) => ids.has(a.preset)).map((a) => a.url)];
}

/** 国内 / 海外 for an official host that has both; null otherwise. */
export function urlRegion(url: string | null | undefined): "cn" | "intl" | null {
  const host = urlHost(url);
  return (host && REGIONS[host]) || null;
}

/** The official provider whose API this URL's host is; null for relays, self-hosted, unknown hosts. */
export function officialPresetOf(url: string | null | undefined, presets: readonly ProfilePreset[]): ProfilePreset | null {
  const host = urlHost(url);
  if (!host) return null;
  const withUrl = officialPresets(presets);
  // A preset's own URL first (cutex profile-presets-v2 `moonshot-cn` owns api.moonshot.cn), then the alternates.
  const exact = withUrl.find((p) => urlHost(p.baseUrl) === host) ?? withUrl.find((p) => officialUrls(p).some((u) => urlHost(u) === host));
  if (exact) return exact;
  const family = OFFICIAL_DOMAINS.find(([domain]) => host === domain || host.endsWith(`.${domain}`))?.[1];
  return family ? (withUrl.find((p) => p.providerFamily === family) ?? null) : null;
}

/** The first official preset of a cutex provider family (`custom:…` / unknown → null). */
export function familyPreset(family: string | null | undefined, presets: readonly ProfilePreset[]): ProfilePreset | null {
  if (!family || family.startsWith("custom")) return null;
  return officialPresets(presets).find((p) => p.providerFamily === family) ?? null;
}

/** "DeepSeek" / "GLM" / "Kimi" for the profile cards' "API Key · …" line. */
const SHORT_FAMILY: Record<string, string> = { deepseek: "DeepSeek", zhipu: "GLM", moonshot: "Kimi", openrouter: "OpenRouter", "openai-api": "OpenAI", minimax: "MiniMax", xai: "Grok" };

export function shortPresetLabel(p: ProfilePreset): string {
  return (p.providerFamily && SHORT_FAMILY[p.providerFamily]) || p.label;
}

export interface BaseUrlState {
  /** The URL's host is the provider's own API (third-party relays are not). */
  official: boolean;
  /** official: whose API it is; otherwise the official provider the profile had (stored URL / family), if any. */
  preset: ProfilePreset | null;
  /** An official URL to offer as 恢复官方地址 (null: already one, or nothing official to go back to). */
  restore: string | null;
}

/**
 * Profile editor, Base URL row: what the (draft) URL is. `stored` = the saved URL, `family` = cutex's
 * providerFamily (only used when the profile has no URL at all). A custom URL never offers an official
 * one unless the saved URL itself was official (then 恢复官方地址 undoes the edit).
 */
export function baseUrlState(url: string | null | undefined, presets: readonly ProfilePreset[], context: { stored?: string | null; family?: string | null } = {}): BaseUrlState {
  const stored = context.stored?.trim() || null;
  const own = officialPresetOf(url, presets);
  const storedPreset = officialPresetOf(stored, presets);
  const storedOfficialUrl = (p: ProfilePreset) => (storedPreset?.id === p.id && officialUrls(p).some((u) => sameUrl(u, stored)) ? stored : null);
  if (own) {
    const exact = officialUrls(own).some((u) => sameUrl(u, url));
    return { official: true, preset: own, restore: exact ? null : (storedOfficialUrl(own) ?? own.baseUrl) };
  }
  const ref = storedPreset ?? (stored ? null : familyPreset(context.family, presets));
  return { official: false, preset: ref, restore: ref ? (storedOfficialUrl(ref) ?? ref.baseUrl) : null };
}

/** One official endpoint the create form offers in one click (another region, or a sibling preset). */
export interface OfficialChoice {
  /** The preset to select with it (a sibling preset of the same family, or the current one). */
  preset: ProfilePreset;
  url: string;
  region: "cn" | "intl" | null;
}

export interface CreateUrlState {
  /** The URL is one of the chosen preset's official endpoints (empty counts: cutex then uses the preset's). */
  official: boolean;
  /** The chosen preset's URL, to put back (shown once the input holds anything else). */
  restore: string | null;
  /** Other official endpoints of the provider: Moonshot .cn / .ai, Z.ai ↔ BigModel. */
  choices: OfficialChoice[];
}

/** Create form, API key: the Base URL input against the chosen preset (null = 自定义). */
export function createUrlState(chosen: ProfilePreset | null, url: string, presets: readonly ProfilePreset[]): CreateUrlState {
  if (!chosen?.baseUrl) return { official: false, restore: null, choices: [] };
  const typed = url.trim();
  const official = !typed || officialUrls(chosen).some((u) => sameUrl(u, typed));
  const restore = !typed || !sameUrl(typed, chosen.baseUrl) ? chosen.baseUrl : null;
  const all: OfficialChoice[] = [
    ...officialUrls(chosen).map((u) => ({ preset: chosen, url: u, region: urlRegion(u) })),
    ...(chosen.providerFamily ? officialPresets(presets).filter((p) => p.id !== chosen.id && p.providerFamily === chosen.providerFamily) : []).map((p) => ({ preset: p, url: p.baseUrl!, region: urlRegion(p.baseUrl) })),
  ];
  // Only endpoints that differ by region / provider (not /v1 spellings), minus the one in the input;
  // one entry per URL, a sibling preset that owns it winning over an alternate of the chosen one.
  const owned = (c: OfficialChoice) => sameUrl(c.url, c.preset.baseUrl);
  const unique = all.filter((c) => {
    const same = all.filter((d) => sameUrl(d.url, c.url));
    return (same.find(owned) ?? same[0]) === c;
  });
  const choices = unique.filter((c) => (c.region !== null || c.preset !== chosen) && !sameUrl(c.url, typed || chosen.baseUrl));
  return { official, restore, choices };
}

/**
 * `POST /v2/profiles` URL fields for a preset (or 自定义 = null): the preset id, plus `baseUrl` only
 * when the input differs from the preset's official URL (custom: always). `error` = the input is unusable.
 */
export function createUrlFields(chosen: { id: string; preset: ProfilePreset | null }, url: string): { preset?: string; baseUrl?: string } | { error: "baseUrlMissing" | "baseUrlInvalid" } {
  const typed = url.trim();
  const official = chosen.preset?.baseUrl ?? null;
  if (chosen.id && official) {
    if (!typed) return { preset: chosen.id };
    if (!validBaseUrl(typed)) return { error: "baseUrlInvalid" };
    return sameUrl(typed, official) ? { preset: chosen.id } : { preset: chosen.id, baseUrl: typed };
  }
  if (!typed) return { error: "baseUrlMissing" };
  if (!validBaseUrl(typed)) return { error: "baseUrlInvalid" };
  // A relay preset (Gemini): its id carries the family config, the URL is the relay's.
  if (chosen.id && chosen.preset && chosen.preset.id.toLowerCase() !== "custom") return { preset: chosen.id, baseUrl: typed };
  return { baseUrl: typed };
}
