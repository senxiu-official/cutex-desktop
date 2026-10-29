// Profile runtime variants in the renderer (cutex profile-runtime-variants, docs/design/042): what the new-profile
// flow, the profile editor's 服务与凭证 / 运行时变体 sections and the new-agent page show. Pure, unit-tested.
//
// The compatibility matrix is cutex's (`runtimeCompatibility` on each profile). Before a profile exists the new-profile
// flow previews it from the preset (`ProfilePreset.runtimeCompatibility`, when cutex sends it) or, until then, from
// `previewCompatibility` — the contract's table (r265-profile-variants.md §2) for the first screen only. After the
// create the profile's own answer decides which variants are added; a mismatch is reported, never papered over.
import { PROFILE_RUNTIME_VARIANTS_FEATURE, variantBaseUrl, type CompatibilityStatus, type ProfileRuntimeVariant, type RuntimeCompatibility, type VariantAddRequest, type VariantDefaults, type VariantRuntime } from "../../../shared/profileVariants";
import type { CredentialSourcePatch } from "../../../shared/profileVariants";
import type { ProfileCreateBody, ProfileCreateKind, ProfileItem, ProfilePreset } from "../../../shared/ipc";
import type { MessageKey } from "../i18n";
import { urlHost } from "./profilePresets";
import { DSH_DEFAULT_MODEL, dshEffortOf } from "./dshModels";
import { DSH_NOT_RECOMMENDED } from "./dshNotice";

export { PROFILE_RUNTIME_VARIANTS_FEATURE };

/** The host reports variants: the new forms; otherwise the old ones stay. */
export function variantsOn(features: ReadonlySet<string>): boolean {
  return features.has(PROFILE_RUNTIME_VARIANTS_FEATURE);
}

export const RUNTIME_LABEL: Record<VariantRuntime, string> = { codex: "cute-codex", claude: "Claude", dsh: "DSH", kimi: "Kimi" };

/** Display order of the runtime rows. */
const ORDER: readonly VariantRuntime[] = ["codex", "dsh", "kimi", "claude"];

/** The profile's variants as cutex lists them, primary first; null on an older host. */
export function variantsOf(p: Pick<ProfileItem, "runtimeVariants"> | null | undefined): ProfileRuntimeVariant[] | null {
  const list = p?.runtimeVariants;
  if (!Array.isArray(list) || !list.length) return null;
  return [...list].sort((a, b) => Number(b.primary) - Number(a.primary) || ORDER.indexOf(a.runtime) - ORDER.indexOf(b.runtime));
}

/** The variant new agents get when none is picked. */
export function defaultVariantOf(p: Pick<ProfileItem, "runtimeVariants" | "defaultVariant"> | null | undefined): ProfileRuntimeVariant | null {
  const list = variantsOf(p);
  if (!list) return null;
  return list.find((v) => v.id === p?.defaultVariant) ?? list.find((v) => v.primary) ?? list[0]!;
}

/**
 * The reasoning level a new agent on this variant gets without a pick: the variant's default, else the default of
 * the model in cutex's catalog for the variant (DSH: `high`); null when neither is known.
 */
export function variantEffort(v: Pick<ProfileRuntimeVariant, "defaults" | "models">, model: string | null): string | null {
  if (v.defaults.reasoningEffort) return v.defaults.reasoningEffort;
  const models = v.models ?? [];
  const row = models.find((m) => m.id === model) ?? (model ? undefined : models.find((m) => m.isDefault));
  return row?.defaultReasoningEffort ?? null;
}

/** A variant cutex lets new agents start on right now (compatibility `supported`). */
export function variantStatus(p: Pick<ProfileItem, "runtimeCompatibility"> | null | undefined, runtime: VariantRuntime): RuntimeCompatibility | null {
  return p?.runtimeCompatibility?.find((c) => c.runtime === runtime) ?? null;
}

/** Runtimes the editor's 添加变体 offers: right for the credential (needs-install included), not there yet. */
export function addableRuntimes(p: Pick<ProfileItem, "runtimeCompatibility"> | null | undefined): RuntimeCompatibility[] {
  return (p?.runtimeCompatibility ?? []).filter((c) => !c.variantPresent && c.status !== "unsupported").sort((a, b) => ORDER.indexOf(a.runtime) - ORDER.indexOf(b.runtime));
}

/** Agents (archived included) bound to any variant of the profile: who a credential change reaches at their next start. */
export function boundAgents(p: Pick<ProfileItem, "runtimeVariants"> | null | undefined): number {
  return (variantsOf(p) ?? []).reduce((n, v) => n + (v.inUse || 0), 0);
}

const REASONS: Record<string, MessageKey> = {
  chatgptLoginCodexOnly: "variants.reason.chatgptLoginCodexOnly",
  anthropicRouteRequired: "variants.reason.anthropicRouteRequired",
  providerNotDeepseekNative: "variants.reason.providerNotDeepseekNative",
  anthropicRouteNotYetSupported: "variants.reason.anthropicRouteNotYetSupported",
  claudeCredentialClaudeOnly: "variants.reason.claudeCredentialClaudeOnly",
  dshProfileCodexVariantNotYetSupported: "variants.reason.dshProfileCodexVariantNotYetSupported",
  platformUnsupported: "variants.reason.platformUnsupported",
  envCredentialDshOnly: "variants.reason.envCredentialDshOnly",
  providerNotKimiNative: "variants.reason.providerNotKimiNative",
  kimiAccountKimiOnly: "variants.reason.kimiAccountKimiOnly",
};

/** Why a runtime is not offered, in our words (unknown codes: a generic line with the code). */
export function reasonKey(reason: string | null | undefined): MessageKey | null {
  return reason ? (REASONS[reason] ?? null) : null;
}

/** cutex's create-time variant refusals (contract §5; the code rides in the error message), shown in plain words. */
const CREATE_REFUSALS: Array<[string, MessageKey]> = [
  ["unknown_variant", "variants.createRefusal.unknownVariant"],
  ["variant_runtime_unavailable", "variants.createRefusal.runtimeUnavailable"],
  ["credential_missing", "variants.createRefusal.credentialMissing"],
];

export function variantCreateRefusalKey(message: string): MessageKey | null {
  return CREATE_REFUSALS.find(([code]) => message.includes(code))?.[1] ?? null;
}

export function statusKey(status: CompatibilityStatus): MessageKey {
  return status === "supported" ? "variants.status.supported" : status === "componentNotInstalled" ? "variants.status.needsInstall" : "variants.status.unsupported";
}

// ---------- the new-profile flow ----------

/** `kimi`: a Kimi-kind Profile whose credential is a Kimi account (cutex kimi-runtime-profiles, r266). */
export type NewProfileProvider = "chatgpt" | "claude" | "apiKey" | "kimi";

export interface NewProfileDraft {
  provider: NewProfileProvider;
  /** apiKey: preset id ("" = custom). */
  preset: string;
  /** apiKey: the Base URL as typed ("" = the preset's official one). */
  baseUrl: string;
  /** Write-only key ("" = set it later on the profile page). */
  apiKey: string;
  /** Advanced (DSH only): read the key from this host variable instead; null = stored key. */
  envName: string | null;
  claudeAccount?: string;
  /** provider `kimi`: the Kimi account (`ka-…`) that is the credential; "" = none chosen yet. */
  kimiAccount?: string;
  /** Checked variants. */
  runtimes: VariantRuntime[];
  /** Per-variant default model / effort ("" = runtime default). */
  defaults: Partial<Record<VariantRuntime, { model: string; reasoningEffort: string }>>;
  /** profile-relay-runtimes: explicit runtime addresses (currently only DSH has its own). */
  variantBaseUrls?: Partial<Record<VariantRuntime, string>>;
  name: string;
  color: string | null;
}

/** DeepSeek's own API on its official host (contract §2: preset id `deepseek` and host api.deepseek.com). */
export function isDeepseekNative(preset: ProfilePreset | null, baseUrl: string): boolean {
  if (!preset || preset.id.toLowerCase() !== "deepseek") return false;
  const host = urlHost(baseUrl.trim() || preset.baseUrl);
  return host === "api.deepseek.com";
}

const KIMI_PROVIDERS = new Set(["moonshot", "moonshot-cn", "kimi", "kimi-code", "kimi-code-cn"]);
const KIMI_HOSTS = new Set(["api.moonshot.ai", "api.moonshot.cn", "api.kimi.com", "api.kimi.ai"]);

/** Kimi's own API (contract r266 §2: a Moonshot / Kimi Code preset on an official https host; a relay is not Kimi). */
export function isKimiNative(preset: ProfilePreset | null, baseUrl: string): boolean {
  if (!preset) return false;
  const ids = [preset.id, preset.providerId, ...(preset.aliases ?? [])].map((x) => x?.toLowerCase());
  if (!ids.some((id) => id && KIMI_PROVIDERS.has(id))) return false;
  const url = baseUrl.trim() || preset.baseUrl || "";
  return /^https:\/\//i.test(url) && KIMI_HOSTS.has(urlHost(url) ?? "");
}

/** The matrix before the profile exists (see the header): the preset's own rows when cutex sends them. */
export function previewCompatibility(d: Pick<NewProfileDraft, "provider" | "envName" | "baseUrl">, preset: ProfilePreset | null, opts: { dshInstalled: boolean; claudeInstalled: boolean; kimiProfiles?: boolean; kimiInstalled?: boolean; relayRuntimes?: boolean }): RuntimeCompatibility[] {
  const fromHost = preset?.runtimeCompatibility;
  // New hosts decide by provider; official-host fallback remains for old hosts without the relay capability.
  const provider = (preset?.providerId || preset?.id || "").trim().toLowerCase();
  const deepseek = opts.relayRuntimes ? provider === "deepseek" : isDeepseekNative(preset, d.baseUrl);
  const kimi = opts.relayRuntimes ? KIMI_PROVIDERS.has(provider) : isKimiNative(preset, d.baseUrl);
  const row = (runtime: VariantRuntime, status: CompatibilityStatus, reason: string | null = null): RuntimeCompatibility => ({ runtime, status, reason, variantPresent: false });
  const kimiOk = opts.kimiInstalled ? "supported" : "componentNotInstalled";
  let rows: RuntimeCompatibility[];
  if (d.provider === "kimi") rows = [row("codex", "unsupported", "kimiAccountKimiOnly"), row("dsh", "unsupported", "kimiAccountKimiOnly"), row("claude", "unsupported", "kimiAccountKimiOnly"), row("kimi", kimiOk)];
  else if (d.provider === "apiKey" && Array.isArray(fromHost) && fromHost.length) rows = fromHost.map((r) => ({ ...r, variantPresent: false }));
  else if (d.provider === "chatgpt") rows = [row("codex", "supported"), row("dsh", "unsupported", "chatgptLoginCodexOnly"), row("claude", "unsupported", "chatgptLoginCodexOnly")];
  else if (d.provider === "claude") rows = [row("codex", "unsupported", "claudeCredentialClaudeOnly"), row("dsh", "unsupported", "claudeCredentialClaudeOnly"), row("claude", opts.claudeInstalled ? "supported" : "componentNotInstalled")];
  else if (deepseek) rows = [row("codex", "supported"), row("dsh", opts.dshInstalled ? "supported" : "componentNotInstalled"), row("claude", "unsupported", "anthropicRouteNotYetSupported")];
  else if (opts.kimiProfiles && kimi) rows = [row("codex", "supported"), row("dsh", "unsupported", "providerNotDeepseekNative"), row("claude", "unsupported", "anthropicRouteNotYetSupported")];
  else rows = [row("codex", "supported"), row("dsh", "unsupported", "providerNotDeepseekNative"), row("claude", "unsupported", "anthropicRouteRequired")];
  // r266: the kimi column (only on a host with kimi-runtime-profiles; cutex's own preset rows already carry it).
  if (opts.kimiProfiles && !rows.some((r) => r.runtime === "kimi")) {
    const reason = d.provider === "chatgpt" ? "chatgptLoginCodexOnly" : d.provider === "claude" ? "claudeCredentialClaudeOnly" : null;
    rows = [...rows, reason ? row("kimi", "unsupported", reason) : kimi ? row("kimi", kimiOk) : row("kimi", "unsupported", "providerNotKimiNative")];
  }
  if (!opts.kimiProfiles) rows = rows.filter((r) => r.runtime !== "kimi");
  // A key read from a host variable is a DSH-profile source only (contract §3).
  if (d.envName !== null) rows = rows.map((r) => ((r.runtime === "codex" || r.runtime === "kimi") && r.status !== "unsupported" ? { ...r, status: "unsupported", reason: "envCredentialDshOnly" } : r));
  return rows.sort((a, b) => ORDER.indexOf(a.runtime) - ORDER.indexOf(b.runtime));
}

/**
 * The variants checked at first: every runtime cutex supports outright, except the ACP runtimes (DSH, Kimi) when
 * another one is there — they are added by ticking (owner 2026-10-27: cute-codex stays the default). A Kimi account
 * Profile has only kimi: checked even while it needs installing (it is the Profile's own runtime).
 */
export function initialRuntimes(rows: readonly RuntimeCompatibility[]): VariantRuntime[] {
  const ok = rows.filter((r) => r.status === "supported").map((r) => r.runtime);
  const withoutAcp = ok.filter((r) => r !== "dsh" && r !== "kimi");
  if (withoutAcp.length) return withoutAcp;
  if (ok.length) return ok.slice(0, 1);
  const only = rows.filter((r) => r.status !== "unsupported");
  return only.length === 1 && only[0]!.runtime === "kimi" ? ["kimi"] : [];
}

/**
 * The `variantId` a new agent / chat sends: the variant the page showed, explicitly — except when the profile is
 * left to cutex's auto pick (`auto:<provider>`), whose pick takes its own default variant. Older hosts (no variants
 * shown): nothing.
 */
export function createVariantId(shown: Pick<ProfileRuntimeVariant, "id"> | null | undefined, profileSent: string | null | undefined): string | undefined {
  if (!shown || profileSent?.startsWith("auto:")) return undefined;
  return shown.id;
}

/**
 * The default variant of a new Profile. While DSH is「暂不建议使用」(lib/dshNotice): cute-codex when it is checked;
 * once the label goes, DSH when it is checked (owner 2026-10-27).
 */
export function plannedDefault(runtimes: readonly VariantRuntime[], dshNotRecommended = DSH_NOT_RECOMMENDED): VariantRuntime | null {
  if (!dshNotRecommended && runtimes.includes("dsh")) return "dsh";
  // Kimi: cute-codex stays the default of a Kimi / Moonshot API-key Profile whatever the label says (owner, r266 §2).
  return runtimes.includes("codex") ? "codex" : (runtimes[0] ?? null);
}

export interface NewProfilePlan {
  create: ProfileCreateBody;
  /** Secondary variants to add after the create (`POST …/variants`). */
  addVariants: VariantAddRequest[];
  /** PATCH `defaultVariant` after the adds; null = keep the primary. */
  defaultVariant: VariantRuntime | null;
  /** PATCH `color` after the create; null = automatic. */
  color: string | null;
  /** A Kimi-kind Profile: PATCH its primary `kimi` variant's defaults after the create (it has no model fields). */
  primaryDefaults?: { variantId: string; defaults: Partial<VariantDefaults> } | null;
}

export type PlanError = "noRuntime" | "unsupportedRuntime" | "envNameInvalid" | "kimiAccountMissing" | "variantBaseUrlMissing" | "variantBaseUrlInvalid";

export interface NewProfilePlanOptions {
  /** The form's relay address classification: a selected DSH runtime needs its own explicit address. */
  dshBaseUrlRequired?: boolean;
}

function trimmedDefaults(d: { model: string; reasoningEffort: string } | undefined): Partial<VariantDefaults> | undefined {
  if (!d) return undefined;
  const out: Partial<VariantDefaults> = {};
  if (d.model.trim()) out.model = d.model.trim();
  if (d.reasoningEffort.trim()) out.reasoningEffort = d.reasoningEffort.trim();
  return Object.keys(out).length ? out : undefined;
}

/**
 * Turns the flow's choices into requests. The create kind follows the checked variants: cute-codex checked → a
 * Codex profile (`apiKey` / `chatgpt`), DSH then added as a variant; DSH alone → a DSH profile (its key stored by
 * cutex, or the named variable); Claude → a Claude profile. `base` = the name / preset / URL fields already checked
 * by lib/profileCreate.createRequestOf.
 */
export function newProfilePlan(d: NewProfileDraft, base: { name: string; preset?: string; baseUrl?: string; claudeAccount?: string }, rows: readonly RuntimeCompatibility[], opts: NewProfilePlanOptions = {}): { plan: NewProfilePlan } | { error: PlanError } {
  const runtimes = ORDER.filter((r) => d.runtimes.includes(r));
  if (!runtimes.length) return { error: "noRuntime" };
  if (runtimes.some((r) => rows.find((x) => x.runtime === r)?.status === "unsupported" || !rows.some((x) => x.runtime === r))) return { error: "unsupportedRuntime" };
  if (d.envName !== null && !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(d.envName.trim())) return { error: "envNameInvalid" };
  let dshAddress: string | undefined;
  if (runtimes.includes("dsh")) {
    const rawAddress = d.variantBaseUrls?.dsh?.trim();
    if (rawAddress) {
      try { dshAddress = variantBaseUrl(rawAddress); }
      catch { return { error: "variantBaseUrlInvalid" }; }
    } else if (opts.dshBaseUrlRequired) return { error: "variantBaseUrlMissing" };
  }
  const key = d.apiKey.trim();
  const credential: CredentialSourcePatch | undefined = d.envName !== null ? { source: "env", envName: d.envName.trim() } : undefined;
  let kind: ProfileCreateKind;
  let primary: VariantRuntime;
  if (d.provider === "kimi") {
    if (!d.kimiAccount) return { error: "kimiAccountMissing" };
    (kind = "kimi"), (primary = "kimi");
  } else if (d.provider === "claude") (kind = "claude"), (primary = "claude");
  else if (d.provider === "chatgpt") (kind = "chatgpt"), (primary = "codex");
  // Kimi API credentials are a Codex API-key profile with a Kimi secondary variant (not a DSH profile).
  else if (runtimes.includes("codex") || runtimes.includes("kimi")) (kind = "apiKey"), (primary = "codex");
  else (kind = "dsh"), (primary = "dsh");
  const create: ProfileCreateBody = { name: base.name, kind };
  if (kind === "apiKey") {
    if (base.preset) create.preset = base.preset;
    if (base.baseUrl) create.baseUrl = base.baseUrl;
    const model = trimmedDefaults(d.defaults.codex)?.model;
    if (model) create.model = model;
    if (key) create.apiKey = key;
  }
  if (kind === "dsh") {
    const dsh = trimmedDefaults(d.defaults.dsh);
    create.options = { dsh: { model: dsh?.model ?? DSH_DEFAULT_MODEL, ...(dshEffortOf(dsh?.reasoningEffort) ? { reasoningEffort: dshEffortOf(dsh?.reasoningEffort) } : {}) } };
    if (dshAddress) create.interfaceBaseUrls = { deepseekNative: dshAddress };
    // The new flow always names its source: "save the key here" is `stored` even with the key left empty (the
    // profile then waits for a key; launches say credential_missing). Sending neither would be the legacy create,
    // which main/cutex turn into reading DEEPSEEK_API_KEY (QA 2026-10-27).
    if (credential) create.credential = credential;
    else {
      create.credential = { source: "stored" };
      if (key) create.apiKey = key;
    }
  }
  if (kind === "claude" && base.claudeAccount) create.claudeAccount = base.claudeAccount;
  if (kind === "kimi") create.kimiAccount = d.kimiAccount!;
  const kimiPrimary = kind === "kimi" ? trimmedDefaults(d.defaults.kimi) : undefined;
  const addVariants = runtimes.filter((r) => r !== primary).map((runtime) => {
    const defaults = trimmedDefaults(d.defaults[runtime]);
    // DSH: the model the form showed (lib/dshModels), not whatever cutex's own default name is.
    if (runtime === "dsh") {
      return { runtime, defaults: { ...defaults, model: defaults?.model ?? DSH_DEFAULT_MODEL }, ...(dshAddress ? { baseUrl: dshAddress } : {}) };
    }
    return defaults ? { runtime, defaults } : { runtime };
  });
  const wanted = plannedDefault(runtimes);
  return { plan: { create, addVariants, defaultVariant: wanted && wanted !== primary ? wanted : null, color: d.color, ...(kimiPrimary ? { primaryDefaults: { variantId: "kimi", defaults: kimiPrimary } } : {}) } };
}
