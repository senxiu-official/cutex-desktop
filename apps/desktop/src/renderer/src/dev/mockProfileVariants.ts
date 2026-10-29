// Preview mock of cutex profile-runtime-variants (r265 contract, docs/design/042): `?variants` turns the capability
// on. Profiles get `providerInterfaces` / `credential` / `runtimeVariants` / `defaultVariant` / `runtimeCompatibility`
// computed like cutex (contract §2); keys are write-only here too — only presence and a version are kept. `omega`
// (DeepSeek API key) carries a DSH variant with one bound agent, so the editor's refused delete can be seen.
// `?dsh=ready` = the DSH component is installed (else 需要安装). Only dev/mockBridge.ts imports this.
import type { RuntimeCompatibility, ProfileRuntimeVariant, VariantDefaults, VariantRuntime, CredentialSourcePatch, LaunchBinding } from "../../../shared/profileVariants";
import type { CutexRefusal } from "../../../shared/ipc";

const QUERY = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
export const VARIANTS_SCENE = !QUERY.has("legacy") && QUERY.has("variants");
const RELAY_SCENE = QUERY.has("relay");
const DSH_READY = QUERY.get("dsh") === "ready";
/** r266: `?kimi=ready` = the kimi-runtime component is installed (else 需要安装). */
const KIMI_READY = QUERY.get("kimi") === "ready";
/** The Kimi accounts of modules/kimi-accounts/mock.ts that are signed in (a Kimi-kind Profile's credential.present). */
const KIMI_SIGNED_IN = new Set(["ka-work7k2m9q"]);
/** The signed-in account's provisioned catalog (Kimi-kind profiles' primary variant `models`). */
const KIMI_MODELS = [
  { id: "kimi-code/kimi-for-coding", displayName: "Kimi for Coding", inputModalities: ["text", "image"], supportedReasoningEfforts: ["off", "low", "medium", "high", "max"], defaultReasoningEffort: "high", isDefault: true },
  { id: "kimi-code/kimi-k3", displayName: "Kimi K3", inputModalities: ["text", "image"], supportedReasoningEfforts: ["off", "low", "medium", "high"], defaultReasoningEffort: "medium", isDefault: false },
];

/** The core profile record fields this mock reads (dev/mockBridge.ts mockProfiles). */
export interface VariantProfileRecord {
  name: string;
  cliKind?: "codex" | "claude" | "dsh" | "kimi";
  /** Kimi-kind profiles: the Kimi account (`ka-…`). */
  kimiAccount?: string | null;
  authKind: "apiKey" | "chatgpt" | "none";
  apiKeyPresent: boolean;
  config: Record<string, unknown>;
  options?: { dsh?: { model: string; reasoningEffort?: string; apiKeyEnv?: string } };
}

interface VariantState {
  secondary: { id: string; runtime: VariantRuntime; defaults: VariantDefaults }[];
  defaultVariant: string | null;
  /** DSH profiles: stored key or a named variable. */
  source: "stored" | "env";
  envName: string | null;
  storedPresent: boolean;
  version: number;
  /** Kimi-kind profiles: the primary variant's defaults (cutex `kimi_defaults`). */
  kimiDefaults: VariantDefaults;
  dshBaseUrl?: string;
}

const states = new Map<string, VariantState>();
/** Agents bound to a variant that the preview's agent list does not show (archived, hidden): `profile/variant`. */
const extraBound = new Map<string, number>([["omega/dsh", 1]]);
/** launchBinding of agents created in the preview. */
const bindings = new Map<string, LaunchBinding>();

function stateOf(p: VariantProfileRecord): VariantState {
  let s = states.get(p.name);
  if (!s) {
    const dshEnv = p.cliKind === "dsh" ? (p.options?.dsh?.apiKeyEnv ?? "DEEPSEEK_API_KEY") : null;
    s = { secondary: [], defaultVariant: null, source: dshEnv ? "env" : "stored", envName: dshEnv, storedPresent: false, version: p.apiKeyPresent ? 1 : 0, kimiDefaults: { model: p.name === "kimi-work" ? "kimi-code/kimi-for-coding" : null, reasoningEffort: null } };
    if (p.name === "omega") s.secondary.push({ id: "dsh", runtime: "dsh", defaults: { model: "deepseek-flash", reasoningEffort: "high" } });
    states.set(p.name, s);
  }
  return s;
}

const primaryOf = (p: VariantProfileRecord): VariantRuntime => p.cliKind ?? "codex";
const kimiNative = (p: VariantProfileRecord) => ["moonshot", "moonshot-cn", "kimi", "kimi-code", "kimi-code-cn"].includes(String(p.config.modelProvider ?? "")) && (RELAY_SCENE || /^https:\/\/api\.(moonshot\.(ai|cn)|kimi\.(com|ai))(\/|$)/.test(String(p.config.providerBaseUrl ?? "")));
const deepseekNative = (p: VariantProfileRecord) => p.cliKind === "dsh" || (p.config.modelProvider === "deepseek" && (RELAY_SCENE || /^https:\/\/api\.deepseek\.com(\/|$)/.test(String(p.config.providerBaseUrl ?? ""))));

function compatibility(p: VariantProfileRecord, s: VariantState): RuntimeCompatibility[] {
  const has = (r: VariantRuntime) => primaryOf(p) === r || s.secondary.some((v) => v.runtime === r);
  const row = (runtime: VariantRuntime, status: RuntimeCompatibility["status"], reason: string | null = null): RuntimeCompatibility => ({ runtime, status, reason, variantPresent: has(runtime) });
  const dsh = DSH_READY ? "supported" : "componentNotInstalled";
  const kimi = KIMI_READY ? "supported" : "componentNotInstalled";
  if (p.cliKind === "kimi") return [row("codex", "unsupported", "kimiAccountKimiOnly"), row("claude", "unsupported", "kimiAccountKimiOnly"), row("dsh", "unsupported", "kimiAccountKimiOnly"), row("kimi", kimi)];
  if (p.cliKind === "claude") return [row("codex", "unsupported", "claudeCredentialClaudeOnly"), row("claude", "supported"), row("dsh", "unsupported", "claudeCredentialClaudeOnly"), row("kimi", "unsupported", "claudeCredentialClaudeOnly")];
  if (p.cliKind === "dsh") return [row("codex", "unsupported", "dshProfileCodexVariantNotYetSupported"), row("claude", "unsupported", "anthropicRouteNotYetSupported"), row("dsh", dsh), row("kimi", "unsupported", "providerNotKimiNative")];
  if (p.authKind === "chatgpt" || p.authKind === "none") return [row("codex", "supported"), row("claude", "unsupported", "chatgptLoginCodexOnly"), row("dsh", "unsupported", "chatgptLoginCodexOnly"), row("kimi", "unsupported", "chatgptLoginCodexOnly")];
  if (deepseekNative(p)) return [row("codex", "supported"), row("claude", "unsupported", "anthropicRouteNotYetSupported"), row("dsh", dsh), row("kimi", "unsupported", "providerNotKimiNative")];
  if (kimiNative(p)) return [row("codex", "supported"), row("claude", "unsupported", "anthropicRouteNotYetSupported"), row("dsh", "unsupported", "providerNotDeepseekNative"), row("kimi", kimi)];
  return [row("codex", "supported"), row("claude", "unsupported", "anthropicRouteRequired"), row("dsh", "unsupported", "providerNotDeepseekNative"), row("kimi", "unsupported", "providerNotKimiNative")];
}

/** Agents bound to profile + variant: created in the preview with a binding, the profile's unbound ones (primary), extras. */
function inUse(p: VariantProfileRecord, id: string, sessions: readonly { cutexSessionId: string; profile: string | null }[]): number {
  const primary = id === primaryOf(p);
  let n = extraBound.get(`${p.name}/${id}`) ?? 0;
  for (const x of sessions) {
    const b = bindings.get(x.cutexSessionId);
    if (b ? b.profileId === p.name && b.variantId === id : primary && x.profile === p.name) n++;
  }
  return n;
}

export function variantFields(p: VariantProfileRecord, sessions: readonly { cutexSessionId: string; profile: string | null }[]): Record<string, unknown> {
  if (!VARIANTS_SCENE) return {};
  const s = stateOf(p);
  const primary = primaryOf(p);
  const c = p.config;
  const primaryDefaults: VariantDefaults = primary === "kimi" ? { ...s.kimiDefaults } : primary === "dsh"
    ? { model: p.options?.dsh?.model ?? "deepseek-flash", reasoningEffort: p.options?.dsh?.reasoningEffort ?? null }
    : { model: (c.model as string) ?? (primary === "claude" ? "sonnet" : null), reasoningEffort: (c.modelReasoningEffort as string) ?? null };
  const variants: ProfileRuntimeVariant[] = [
    { id: primary, runtime: primary, primary: true, defaults: primaryDefaults, inUse: inUse(p, primary, sessions), ...(primary === "kimi" ? { models: p.kimiAccount && KIMI_SIGNED_IN.has(p.kimiAccount) ? KIMI_MODELS : [] } : {}) },
    ...s.secondary.map((v) => ({ id: v.id, runtime: v.runtime, primary: false, defaults: { ...v.defaults }, inUse: inUse(p, v.id, sessions), ...(v.runtime === "kimi" ? { models: null } : {}) })),
  ];
  const credential = p.cliKind === "kimi"
    ? { source: "kimiAccount", present: !!p.kimiAccount && KIMI_SIGNED_IN.has(p.kimiAccount), kimiAccountId: p.kimiAccount ?? null, envName: null, claudeAccountId: null, version: null, writable: false }
    : p.cliKind === "claude"
    ? { source: "claudeAccount", present: true, envName: null, claudeAccountId: "default", version: null, writable: false }
    : p.cliKind === "dsh"
      ? { source: s.source, present: s.source === "env" ? false : s.storedPresent, envName: s.source === "env" ? s.envName : null, claudeAccountId: null, version: s.source === "stored" ? s.version : null, writable: true }
      : p.authKind === "apiKey"
        ? { source: "stored", present: p.apiKeyPresent, envName: null, claudeAccountId: null, version: p.apiKeyPresent ? Math.max(1, s.version) : null, writable: true }
        : { source: "chatgptLogin", present: p.authKind === "chatgpt", envName: null, claudeAccountId: null, version: null, writable: false };
  const interfaces: { kind: string; baseUrl: string | null }[] = p.cliKind === "kimi" ? [{ kind: "kimiAccount", baseUrl: null }]
    : p.cliKind === "claude" ? [{ kind: "claudeSubscription", baseUrl: null }]
    : p.cliKind === "dsh" ? [{ kind: "deepseekNative", baseUrl: s.dshBaseUrl ?? "https://api.deepseek.com/" }]
      : p.authKind === "apiKey" ? [{ kind: "openaiCompatible", baseUrl: (c.providerBaseUrl as string) ?? null }, ...(deepseekNative(p) ? [{ kind: "deepseekNative", baseUrl: s.dshBaseUrl ?? "https://api.deepseek.com/" }] : [])]
        : [{ kind: "chatgptLogin", baseUrl: null }];
  if (kimiNative(p)) interfaces.push({ kind: "kimiNative", baseUrl: (c.providerBaseUrl as string) ?? null });
  return { ...(p.cliKind === "kimi" ? { kimiAccount: p.kimiAccount ?? null } : {}), providerInterfaces: interfaces, credential, runtimeVariants: variants, defaultVariant: s.defaultVariant ?? primary, runtimeCompatibility: compatibility(p, s) };
}

/** PATCH keys this mock owns on a variants host; returns the rest for the core (a Codex `apiKey` stays core's). */
export function variantPatch<T extends Record<string, unknown>>(p: VariantProfileRecord, patch: T): T {
  if (!VARIANTS_SCENE) {
    if ("credential" in patch || "defaultVariant" in patch || patch.apiKey === null) throw new Error("invalid_request: unknown field");
    return patch;
  }
  const s = stateOf(p);
  const rest: Record<string, unknown> = { ...patch };
  if ("defaultVariant" in patch) {
    const id = patch.defaultVariant as string | null;
    if (id !== null && id !== primaryOf(p) && !s.secondary.some((v) => v.id === id)) throw new Error(`unknown_variant: no variant ${id}`);
    s.defaultVariant = id === primaryOf(p) ? null : id;
    delete rest.defaultVariant;
  }
  if ("kimiAccount" in patch) {
    if (p.cliKind !== "kimi") throw new Error("invalid_request: kimiAccount applies to Kimi profiles only");
    p.kimiAccount = (patch.kimiAccount as string | null) ?? null;
    delete rest.kimiAccount;
  }
  if ("credential" in patch) {
    if (p.cliKind !== "dsh") throw new Error("invalid_request: credential applies to DSH profiles only");
    const c = patch.credential as CredentialSourcePatch;
    s.source = c.source;
    if (c.source === "env") s.envName = c.envName;
    delete rest.credential;
  }
  if ("apiKey" in patch) {
    if (p.cliKind === "dsh") {
      s.storedPresent = patch.apiKey !== null;
      s.source = "stored";
      if (patch.apiKey !== null) s.version++;
      delete rest.apiKey;
    } else if (patch.apiKey === null) throw new Error("invalid_request: apiKey: clearing is supported on DSH profiles only");
    else s.version++;
  }
  return rest as T;
}

/** `POST /v2/profiles` fields of the variants contract, applied after the core made the profile. */
export function variantCreate(p: VariantProfileRecord, request: { apiKey?: string; credential?: CredentialSourcePatch; interfaceBaseUrls?: { deepseekNative?: string | null } }): void {
  if (!VARIANTS_SCENE) return;
  const s = stateOf(p);
  if (RELAY_SCENE && request.interfaceBaseUrls?.deepseekNative) s.dshBaseUrl = request.interfaceBaseUrls.deepseekNative;
  if (p.cliKind === "dsh") {
    if (request.credential?.source === "env") (s.source = "env"), (s.envName = request.credential.envName);
    else if (request.apiKey) (s.source = "stored"), (s.storedPresent = true), (s.version = 1), (s.envName = null);
    else if (request.credential?.source === "stored") (s.source = "stored"), (s.envName = null);
  } else if (request.apiKey) {
    p.apiKeyPresent = true;
    s.version = 1;
  }
}

const refusal = (code: string, message: string, extra: Partial<CutexRefusal> = {}) => ({ ok: false as const, error: { code, message, ...extra } });

export function variantApi(find: (name: string) => VariantProfileRecord | undefined, detail: (name: string) => unknown, sessions: () => readonly { cutexSessionId: string; profile: string | null; displayName: string }[]) {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  return {
    async addProfileVariant(name: string, request: { runtime: VariantRuntime; id?: string; defaults?: Partial<VariantDefaults>; baseUrl?: string }) {
      await wait(300);
      const p = find(name);
      if (!p) return refusal("profile_not_found", `no profile ${name}`);
      const s = stateOf(p);
      const row = compatibility(p, s).find((r) => r.runtime === request.runtime);
      if (!row || row.status === "unsupported") return refusal("variant_runtime_unsupported", `runtime ${request.runtime} is not available for this profile (${row?.reason ?? "unknown"})`);
      if (row.variantPresent) return refusal("variant_exists", `profile already has a ${request.runtime} variant`);
      const variant = { id: request.id ?? request.runtime, runtime: request.runtime, defaults: { model: request.defaults?.model ?? (request.runtime === "dsh" ? "deepseek-flash" : request.runtime === "kimi" ? ((p.config.model as string) ?? "kimi-for-coding") : null), reasoningEffort: request.defaults?.reasoningEffort ?? null } };
      if (RELAY_SCENE && request.runtime === "dsh") s.dshBaseUrl = request.baseUrl;
      s.secondary.push(variant);
      console.info(`[mock] POST /v2/profiles/${name}/variants`, request);
      return { ok: true as const, profile: detail(name) as never, variant: { ...variant, primary: false, inUse: 0 } };
    },
    async patchProfileVariant(name: string, variantId: string, defaults: Partial<VariantDefaults>) {
      await wait(250);
      const p = find(name);
      if (!p) return refusal("profile_not_found", `no profile ${name}`);
      const s = stateOf(p);
      if (variantId === primaryOf(p)) {
        if (p.cliKind === "kimi") Object.assign(s.kimiDefaults, defaults);
        else if (p.cliKind === "dsh") p.options = { dsh: { ...(p.options?.dsh ?? { model: "deepseek-flash" }), ...(defaults.model ? { model: defaults.model } : {}), ...(defaults.reasoningEffort !== undefined ? { reasoningEffort: defaults.reasoningEffort ?? undefined } : {}) } };
        else {
          if (defaults.model !== undefined) p.config.model = defaults.model;
          if (defaults.reasoningEffort !== undefined) p.config.modelReasoningEffort = defaults.reasoningEffort;
        }
      } else {
        const v = s.secondary.find((x) => x.id === variantId);
        if (!v) return refusal("unknown_variant", `no variant ${variantId}`);
        Object.assign(v.defaults, defaults);
      }
      return { ok: true as const, profile: detail(name) as never, variant: null };
    },
    async deleteProfileVariant(name: string, variantId: string) {
      await wait(250);
      const p = find(name);
      if (!p) return refusal("profile_not_found", `no profile ${name}`);
      const s = stateOf(p);
      if (variantId === primaryOf(p)) return refusal("primary_variant_not_removable", "the profile's own runtime cannot be removed");
      const i = s.secondary.findIndex((x) => x.id === variantId);
      if (i < 0) return refusal("unknown_variant", `no variant ${variantId}`);
      const count = inUse(p, variantId, sessions());
      if (count > 0) {
        const bound = sessions().filter((x) => bindings.get(x.cutexSessionId)?.variantId === variantId && bindings.get(x.cutexSessionId)?.profileId === name);
        return refusal("variant_in_use", `${count} agents are bound to this variant`, { count, sessions: bound.map((x) => ({ cutexSessionId: x.cutexSessionId, displayName: x.displayName })) });
      }
      s.secondary.splice(i, 1);
      if (s.defaultVariant === variantId) s.defaultVariant = null;
      return { ok: true as const, defaultVariant: s.defaultVariant ?? primaryOf(p) };
    },
  };
}

/** `variantId` of a new agent / chat: the binding cutex would fix (throws like cutex). */
export function bindNewSession(p: VariantProfileRecord | undefined, variantId: string | undefined, sessionId: string): LaunchBinding | null {
  if (!VARIANTS_SCENE || !p) {
    if (variantId !== undefined) throw new Error("invalid_request: unknown field variantId");
    return null;
  }
  const s = stateOf(p);
  const id = variantId ?? s.defaultVariant ?? primaryOf(p);
  const primary = id === primaryOf(p);
  const v = primary ? { id, runtime: primaryOf(p) } : s.secondary.find((x) => x.id === id);
  if (!v) throw new Error(`unknown_variant: profile ${p.name} has no variant ${id}`);
  const row = compatibility(p, s).find((r) => r.runtime === v.runtime);
  if (row?.status !== "supported") throw new Error(`variant_runtime_unavailable: ${v.runtime} is ${row?.status ?? "unsupported"} (${row?.reason ?? "component not installed"})`);
  const defaults = primary && p.cliKind === "kimi" ? { ...s.kimiDefaults } : primary ? { model: (p.config.model as string) ?? null, reasoningEffort: (p.config.modelReasoningEffort as string) ?? null } : (s.secondary.find((x) => x.id === id)?.defaults ?? { model: null, reasoningEffort: null });
  const binding: LaunchBinding = {
    profileId: p.name, variantId: id, runtime: v.runtime,
    credential: p.cliKind === "kimi" ? { source: "kimiAccount", kimiAccountId: p.kimiAccount ?? null } : p.cliKind === "dsh" ? { source: s.source, envName: s.source === "env" ? s.envName : null, version: s.source === "stored" ? s.version : null } : { source: p.authKind === "apiKey" ? "stored" : p.cliKind === "claude" ? "claudeAccount" : "chatgptLogin", version: p.authKind === "apiKey" ? Math.max(1, s.version) : null },
    model: defaults.model, reasoningEffort: defaults.reasoningEffort, runtimePackageVersion: v.runtime === "dsh" ? "0.2.1-rc.3" : v.runtime === "kimi" ? "2.3.3" : null, boundAt: new Date().toISOString(),
  };
  bindings.set(sessionId, binding);
  return binding;
}
