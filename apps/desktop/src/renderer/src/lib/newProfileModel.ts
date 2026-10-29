// Settings → Profiles → 添加, provider-first (design .claude/previews/profile-new-flow.md §3, phase P1):
// 服务商 cards → 登录方式 (each with what it leads to) → 接口地址 → 运行时 → 默认模型 → 名称与颜色, then
// a summary line. Pure: cards, options, address states, the create plan and the summary come from
// cutex's presets (`GET /v2/profile-presets`) and capability flags; no React, no bridge.
//
// Legacy hosts keep one runtime per login method. Variant-capable hosts share these provider and
// auth choices (including capability-gated Kimi accounts), then use lib/profileVariants to plan
// runtime variants. Addresses remain editable defaults; provider identity decides compatibility.
import type { ClaudeAccountCreate, ClaudeKeyEnv } from "../../../shared/claudeAccounts";
import type { ProfileCreateKind, ProfileCreateRequest, ProfilePreset } from "../../../shared/ipc";
import { profileNameError, type ProfileFormError } from "./profileCreate";
import { officialUrls, sameUrl, shortPresetLabel, urlHost, urlRegion, validBaseUrl } from "./profilePresets";

/** cutex capability: `/v2/claude/accounts` (Claude API accounts; the inline Anthropic key). */
export const CLAUDE_ACCOUNTS_FEATURE = "claude-accounts";
/** cutex capability: the DSH runtime component (legacy DSH-kind Profiles reading a host variable). */
export const DSH_RUNTIME_FEATURE = "dsh-runtime";

export type NewProfileRuntime = "codex" | "claude" | "dsh" | "kimi";
export type ProviderCardId = "openai" | "anthropic" | "deepseek" | "kimi" | "glm" | "gemini" | "more" | "custom";
/**
 * chatgpt / claudeSubscription: a login, no address. apiKey: cute-codex on an OpenAI-compatible
 * address. anthropicKey: Anthropic's own key; anthropicCompatible: a provider's Anthropic-compatible
 * key (decision 5) — both create a Claude API account and a Claude Profile on it. customAnthropic:
 * the same on an address of the owner's. dshEnv: the key from a host variable (DSH only, B10).
 */
export type NewProfileAuth = "chatgpt" | "claudeSubscription" | "kimiAccount" | "apiKey" | "anthropicKey" | "anthropicCompatible" | "customAnthropic" | "dshEnv";

/** One kind of key within a login method (Kimi: Kimi Code / Moonshot; 更多: MiniMax / xAI / …), with its regions. */
export interface KeyGroup {
  key: string;
  /** cutex's own label (shortPresetLabel); the UI may translate known keys. */
  label: string;
  /** cutex presets, one per region / endpoint, in cutex's order (the first is the default). */
  presets: ProfilePreset[];
}

export interface AuthOption {
  /** Unique within a card ("apiKey", "apiKey:kimi-code", "anthropicCompatible", …). */
  id: string;
  auth: NewProfileAuth;
  runtime: NewProfileRuntime;
  /** API-key options: the key kinds to choose from (a choice row only when > 1). Login options: none. */
  groups: KeyGroup[];
  /** Shown under 高级 (DeepSeek's host variable). */
  advanced?: boolean;
}

export interface ProviderCard {
  id: ProviderCardId;
  options: AuthOption[];
  /** The runtimes the card's options lead to, deduplicated, in option order. */
  runtimes: NewProfileRuntime[];
}

const FAMILY_CARD: Record<string, ProviderCardId> = {
  "openai-api": "openai",
  deepseek: "deepseek",
  moonshot: "kimi",
  "kimi-code": "kimi",
  zhipu: "glm",
};

const isCustom = (p: ProfilePreset) => p.id.toLowerCase() === "custom";

/** The card a cutex preset belongs to; null = 自定义 (handled on its own). */
function cardOfPreset(p: ProfilePreset): ProviderCardId | null {
  if (isCustom(p)) return null;
  if (p.providerFamily && FAMILY_CARD[p.providerFamily]) return FAMILY_CARD[p.providerFamily]!;
  if (p.providerId === "gemini" || p.id.toLowerCase() === "gemini") return "gemini";
  return "more";
}

/** Presets grouped by family (no family: by provider id), keeping cutex's order. */
function groupsOf(presets: readonly ProfilePreset[]): KeyGroup[] {
  const out: KeyGroup[] = [];
  for (const p of presets) {
    const key = p.providerFamily ?? p.providerId ?? p.id;
    const group = out.find((g) => g.key === key);
    if (group) group.presets.push(p);
    else out.push({ key, label: shortPresetLabel(p), presets: [p] });
  }
  return out;
}

/** Anthropic's own API (a Claude API account without a base URL uses it). */
export const ANTHROPIC_OFFICIAL_URL = "https://api.anthropic.com";

/**
 * Anthropic-compatible addresses of the providers that publish one, by cutex preset id: only the
 * address the form starts from (editable; the owner's relay is just as valid). cutex's presets don't
 * carry these yet (backend item: an Anthropic interface per preset); unknown → the owner fills it in.
 */
const ANTHROPIC_DEFAULTS: Record<string, string> = {
  deepseek: "https://api.deepseek.com/anthropic",
  zai: "https://api.z.ai/api/anthropic",
  zhipu: "https://open.bigmodel.cn/api/anthropic",
  moonshot: "https://api.moonshot.ai/anthropic",
  "moonshot-cn": "https://api.moonshot.cn/anthropic",
  "kimi-code-cn": "https://api.kimi.com/coding/",
};

/**
 * The cards of a host: from its presets (older cutex: the built-in list) and capabilities. A login
 * method is offered only when the host can do it (no `claude-accounts` → no Anthropic key options;
 * no `dsh-runtime` → no host variable). Cards without any option are left out.
 */
export function providerCards(presets: readonly ProfilePreset[], features: ReadonlySet<string>): ProviderCard[] {
  const claudeApi = features.has(CLAUDE_ACCOUNTS_FEATURE);
  const by = (card: ProviderCardId) => presets.filter((p) => cardOfPreset(p) === card);
  const apiKey = (groups: KeyGroup[], id = "apiKey"): AuthOption[] => (groups.length ? [{ id, auth: "apiKey", runtime: "codex", groups }] : []);
  const compatible = (groups: KeyGroup[]): AuthOption[] => {
    const usable = groups.filter((g) => g.presets.length);
    return claudeApi && usable.length ? [{ id: "anthropicCompatible", auth: "anthropicCompatible", runtime: "claude", groups: usable }] : [];
  };
  const kimi = groupsOf(by("kimi"));
  const custom = presets.find(isCustom);
  const cards: ProviderCard[] = [
    { id: "openai", options: [{ id: "chatgpt", auth: "chatgpt", runtime: "codex", groups: [] }, ...apiKey(groupsOf(by("openai")))], runtimes: [] },
    {
      id: "anthropic",
      options: [{ id: "claudeSubscription", auth: "claudeSubscription", runtime: "claude", groups: [] }, ...(claudeApi ? [{ id: "anthropicKey", auth: "anthropicKey" as const, runtime: "claude" as const, groups: [] }] : [])],
      runtimes: [],
    },
    {
      id: "deepseek",
      options: [
        ...apiKey(groupsOf(by("deepseek"))),
        ...compatible(groupsOf(by("deepseek"))),
        ...(features.has(DSH_RUNTIME_FEATURE) ? [{ id: "dshEnv", auth: "dshEnv" as const, runtime: "dsh" as const, groups: [], advanced: true }] : []),
      ],
      runtimes: [],
    },
    // Kimi Code membership keys and Moonshot open-platform keys are different keys: one option each.
    { id: "kimi", options: [...(features.has("profile-runtime-variants") && features.has("kimi-runtime-profiles") && features.has("kimi-accounts") ? [{ id: "kimiAccount", auth: "kimiAccount" as const, runtime: "kimi" as const, groups: [] }] : []), ...kimi.flatMap((g) => apiKey([g], `apiKey:${g.key}`)), ...compatible(kimi)], runtimes: [] },
    { id: "glm", options: [...apiKey(groupsOf(by("glm"))), ...compatible(groupsOf(by("glm")))], runtimes: [] },
    { id: "gemini", options: apiKey(groupsOf(by("gemini"))), runtimes: [] },
    { id: "more", options: apiKey(groupsOf(by("more"))), runtimes: [] },
    {
      id: "custom",
      options: [
        { id: "customOpenai", auth: "apiKey", runtime: "codex", groups: custom ? [{ key: "custom", label: custom.label, presets: [custom] }] : [] },
        ...(claudeApi ? [{ id: "customAnthropic", auth: "customAnthropic" as const, runtime: "claude" as const, groups: [] }] : []),
      ],
      runtimes: [],
    },
  ];
  return cards
    .filter((c) => c.options.length)
    .map((c) => ({ ...c, runtimes: [...new Set(c.options.map((o) => o.runtime))] }));
}

/** The form's choice: card, login option, key kind and region (preset). */
export interface NewProfileChoice {
  card: ProviderCardId;
  option: string;
  /** KeyGroup.key (API-key options); "" = none. */
  group: string;
  /** Preset id within the group; "" = none (login options, custom). */
  preset: string;
}

/** A card's first option, its first key kind and region. */
export function defaultChoice(card: ProviderCard): NewProfileChoice {
  return choiceFor(card, card.options.find((o) => !o.advanced) ?? card.options[0]!);
}

export function choiceFor(card: ProviderCard, option: AuthOption, groupKey?: string): NewProfileChoice {
  const group = option.groups.find((g) => g.key === groupKey) ?? option.groups[0];
  return { card: card.id, option: option.id, group: group?.key ?? "", preset: group?.presets[0]?.id ?? "" };
}

/** `initialPreset` (编辑页「用这个服务商新建」): the card and API-key option holding that preset. */
export function choiceForPreset(cards: readonly ProviderCard[], presetId: string): NewProfileChoice | null {
  const key = presetId.toLowerCase();
  for (const card of cards)
    for (const option of card.options) {
      if (option.auth !== "apiKey") continue;
      for (const group of option.groups) {
        const p = group.presets.find((x) => x.id.toLowerCase() === key || x.aliases.some((a) => a.toLowerCase() === key));
        if (p) return { card: card.id, option: option.id, group: group.key, preset: p.id };
      }
    }
  return null;
}

export interface Resolved {
  card: ProviderCard;
  option: AuthOption;
  group: KeyGroup | null;
  preset: ProfilePreset | null;
}

/** The choice against the current cards (a card / option the host no longer offers → its first one). */
export function resolveChoice(cards: readonly ProviderCard[], choice: NewProfileChoice): Resolved | null {
  const card = cards.find((c) => c.id === choice.card);
  if (!card) return null;
  const option = card.options.find((o) => o.id === choice.option) ?? card.options[0]!;
  const group = option.groups.find((g) => g.key === choice.group) ?? option.groups[0] ?? null;
  const preset = group?.presets.find((p) => p.id === choice.preset) ?? group?.presets[0] ?? null;
  return { card, option, group, preset };
}

/** 中国大陆 / 海外 for each preset of a group (null when the group has one endpoint or regions aren't known). */
export function regionsOf(group: KeyGroup | null): { preset: ProfilePreset; region: "cn" | "intl" | null }[] | null {
  if (!group || group.presets.length < 2) return null;
  return group.presets.map((preset) => ({ preset, region: urlRegion(preset.baseUrl) }));
}

/** cutex's create kind for a login method. */
export function createKindOf(auth: NewProfileAuth): ProfileCreateKind {
  switch (auth) {
    case "kimiAccount":
      return "kimi";
    case "chatgpt":
      return "chatgpt";
    case "apiKey":
      return "apiKey";
    case "dshEnv":
      return "dsh";
    default:
      return "claude";
  }
}

/** The login method takes a key in this form (stored write-only by cutex; may be left empty). */
export function takesKey(auth: NewProfileAuth): boolean {
  return auth === "apiKey" || auth === "anthropicKey" || auth === "anthropicCompatible" || auth === "customAnthropic";
}

/** A Claude API account is created first (the inline Anthropic key, decisions 4 / 5). */
export function needsClaudeAccount(auth: NewProfileAuth): boolean {
  return auth === "anthropicKey" || auth === "anthropicCompatible" || auth === "customAnthropic";
}

/** Which interface the address must speak (the 「必填」 copy and the relay note). */
export type AddressInterface = "openai" | "anthropic";

export interface AddressSpec {
  interface: AddressInterface;
  /** The address the field starts from; null = none (required). */
  official: string | null;
  /** More official spellings of the same endpoint (DeepSeek's `/v1`): typing one is not a relay. */
  officialAlternates: string[];
  required: boolean;
}

/** The address row of a choice; null = the login method has no address (logins, host variable). */
export function addressSpecOf(r: Resolved): AddressSpec | null {
  const { option, preset } = r;
  switch (option.auth) {
    case "apiKey": {
      const official = preset?.baseUrl && !preset.baseUrlRequired ? preset.baseUrl : null;
      return { interface: "openai", official, officialAlternates: preset && official ? officialUrls(preset).filter((u) => !sameUrl(u, official)) : [], required: !official };
    }
    case "anthropicKey":
      return { interface: "anthropic", official: ANTHROPIC_OFFICIAL_URL, officialAlternates: [], required: false };
    case "anthropicCompatible": {
      const official = (preset && ANTHROPIC_DEFAULTS[preset.id]) ?? null;
      return { interface: "anthropic", official, officialAlternates: [], required: !official };
    }
    case "customAnthropic":
      return { interface: "anthropic", official: null, officialAlternates: [], required: true };
    default:
      return null;
  }
}

export interface AddressState {
  /** What the field shows (the official default until edited). */
  value: string;
  /** The field holds the official default (or an official spelling of it). */
  official: boolean;
  /** Edited away from an official default: 中转 tag + 恢复官方地址. */
  relay: boolean;
  /** Empty and required (no official default). */
  missing: boolean;
  invalid: boolean;
}

/** `typed` = the owner's input; null = untouched (the official default). */
export function addressState(spec: AddressSpec, typed: string | null): AddressState {
  const value = typed ?? spec.official ?? "";
  const t = value.trim();
  const official = !!spec.official && (!t || [spec.official, ...spec.officialAlternates].some((u) => sameUrl(u, t)));
  return { value, official, relay: !!spec.official && !!t && !official, missing: !t && spec.required, invalid: !!t && !validBaseUrl(t) };
}

/** The form as the owner filled it in. Keys are cleared by the component once submitted. */
export interface NewProfileForm {
  name: string;
  /** null = untouched (the official default). */
  address: string | null;
  apiKey: string;
  /** Free text (cute-codex / Claude); empty = the provider's default. */
  model: string;
  /** null = automatic (cutex picks by provider). */
  color: string | null;
  /** Anthropic subscription with `claude-accounts`: the account (`default` = the shared one). */
  claudeAccount?: string;
}

export interface CreatePlan {
  /** Created first; its id goes into `profile.claudeAccount`. Carries the write-only key. */
  account: (ClaudeAccountCreate & { apiKey?: string }) | null;
  profile: ProfileCreateRequest;
  /** PATCH after create (cutex picks a colour when null). */
  color: string | null;
}

export type PlanError = ProfileFormError | "accountLabelInvalid";

/** Header the Claude account sends the key in: Anthropic's own → x-api-key; providers / relays → Bearer (their docs). */
function keyEnvOf(auth: NewProfileAuth): ClaudeKeyEnv {
  return auth === "anthropicKey" ? "ANTHROPIC_API_KEY" : "ANTHROPIC_AUTH_TOKEN";
}

/**
 * The requests, in order (design §3 create order: account → Profile → colour). API key: the preset
 * id, `baseUrl` only when the address isn't the official default, `apiKey` only when typed. Claude
 * API account: `baseUrl` only when not Anthropic's own; labelled like the Profile.
 */
export function createPlanOf(r: Resolved, form: NewProfileForm, existing: readonly string[]): { plan: CreatePlan } | { error: PlanError } {
  const nameError = profileNameError(form.name, existing);
  if (nameError) return { error: nameError };
  const name = form.name.trim();
  const auth = r.option.auth;
  const spec = addressSpecOf(r);
  const address = spec ? addressState(spec, form.address) : null;
  if (address?.missing) return { error: "baseUrlMissing" };
  if (address?.invalid) return { error: "baseUrlInvalid" };
  const url = address?.value.trim() ?? "";
  const key = form.apiKey.trim();
  const model = form.model.trim();
  const profile: ProfileCreateRequest = { name, kind: createKindOf(auth) };
  let account: CreatePlan["account"] = null;
  if (auth === "apiKey") {
    const preset = r.preset;
    if (preset && !isCustom(preset)) profile.preset = preset.id;
    if (url && !address!.official) profile.baseUrl = url;
    if (key) profile.apiKey = key;
  } else if (auth === "dshEnv") {
    profile.options = { dsh: { model: "deepseek-v4-flash", apiKeyEnv: "DEEPSEEK_API_KEY" } };
  } else if (needsClaudeAccount(auth)) {
    if (name.toLowerCase() === "default") return { error: "accountLabelInvalid" };
    account = { label: name, kind: "api", keyEnv: keyEnvOf(auth) };
    // Anthropic's own address = no baseUrl (the account's default); a provider's is always sent
    // (emptied = its default again: an account without one would go to Anthropic).
    const accountUrl = url || spec?.official || "";
    if (accountUrl && !(auth === "anthropicKey" && address!.official)) account.baseUrl = accountUrl;
    if (key) account.apiKey = key;
  } else if (auth === "claudeSubscription" && form.claudeAccount && form.claudeAccount !== "default") {
    profile.claudeAccount = form.claudeAccount;
  }
  if (model && auth !== "dshEnv") profile.model = model;
  return { plan: { account, profile, color: form.color } };
}

/** The runtime line's name. */
export const RUNTIME_LABEL: Record<NewProfileRuntime, string> = { codex: "cute-codex", claude: "Claude", dsh: "DSH", kimi: "Kimi" };

/** The host shown as 「经 <host>」 when the address is not the official default. */
export function relayHost(r: Resolved, address: string | null): string | null {
  const spec = addressSpecOf(r);
  if (!spec) return null;
  const state = addressState(spec, address);
  return state.relay || (!spec.official && !state.missing && !state.invalid) ? urlHost(state.value) : null;
}
