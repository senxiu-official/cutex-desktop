// Profile runtime variants and Profile credentials (cutex `profile-runtime-variants`, r265; contract
// upstream/cutex docs/development/r265-profile-variants.md, product rules docs/design/042).
//
// A Profile = provider + ONE credential + one or more runtime variants. The wire views below are cutex's
// (computed there); the desktop never derives the compatibility matrix itself and never infers a new
// agent's runtime from the profile kind when the host reports variants. The request builders are what main
// sends: rebuilt from known fields, so a key reaches cutex only as the write-only `apiKey`.
import type { CutexRefusal, ProfileDetail } from "./ipc";

/** featureList entry; without it the desktop sends none of the fields below and keeps the old forms. */
export const PROFILE_RUNTIME_VARIANTS_FEATURE = "profile-runtime-variants";
export const PROFILE_RELAY_RUNTIMES_FEATURE = "profile-relay-runtimes";

export const VARIANT_RUNTIMES = ["codex", "claude", "dsh", "kimi"] as const;
export type VariantRuntime = (typeof VARIANT_RUNTIMES)[number];

export interface VariantDefaults {
  model: string | null;
  reasoningEffort: string | null;
}

export interface ProfileRuntimeVariant {
  /** `[a-z0-9-]{1,32}`; the primary's id is its runtime name. */
  id: string;
  runtime: VariantRuntime;
  /** The profile's own (legacy `cliKind`) runtime: always there, never removable. */
  primary: boolean;
  defaults: VariantDefaults;
  /** Agents (archived included) bound to this variant. */
  inUse: number;
  /** The runtime's own model catalog (cutex r265 C4: DSH variants); null / absent for the others. */
  models?: VariantModel[] | null;
}

/** One model of a variant's catalog (`runtimeVariants[].models`). */
export interface VariantModel {
  id: string;
  displayName?: string | null;
  inputModalities?: string[];
  supportedReasoningEfforts?: string[];
  defaultReasoningEffort?: string | null;
  isDefault?: boolean;
}

export type CompatibilityStatus = "supported" | "componentNotInstalled" | "unsupported";

/** One row of cutex's compatibility matrix for this profile. */
export interface RuntimeCompatibility {
  runtime: VariantRuntime;
  status: CompatibilityStatus;
  /** e.g. chatgptLoginCodexOnly, providerNotDeepseekNative, anthropicRouteNotYetSupported, platformUnsupported. */
  reason: string | null;
  variantPresent: boolean;
}

export interface ProviderInterface {
  kind: "openaiCompatible" | "deepseekNative" | "kimiNative" | "kimiAccount" | "anthropicCompatible" | "chatgptLogin" | "claudeSubscription" | string;
  baseUrl: string | null;
  /** Additive profile-relay-runtimes metadata; absent on older hosts. */
  baseUrlDefault?: string | null;
  official?: boolean;
  relayAccepted?: boolean;
}

/** Only DSH stores a separate interface address; Kimi shares the profile's main URL. */
export type InterfaceBaseUrls = { deepseekNative?: string | null };

export type CredentialSource = "stored" | "env" | "chatgptLogin" | "claudeAccount" | "kimiAccount" | "none";

/** Never the value: where the key comes from and whether it is there. */
export interface ProfileCredentialView {
  source: CredentialSource;
  present: boolean | null;
  /** `env` only. */
  envName: string | null;
  claudeAccountId: string | null;
  /** cutex kimi-runtime-profiles (r266): the Kimi account of a `kimiAccount` source; absent on older hosts. */
  kimiAccountId?: string | null;
  /** Stored keys: +1 on each write. */
  version: number | null;
  /** This profile takes a write-only `apiKey` by PATCH. */
  writable: boolean;
}

/** The fields cutex adds to profile items / details (absent on older hosts). */
export interface ProfileVariantFields {
  providerInterfaces?: ProviderInterface[];
  credential?: ProfileCredentialView;
  runtimeVariants?: ProfileRuntimeVariant[];
  defaultVariant?: string | null;
  runtimeCompatibility?: RuntimeCompatibility[];
}

/** A session's frozen launch binding (`launchBinding`, read-only; no secret). */
export type LaunchBinding = import("@cutex-desktop/protocol").SessionLaunchBinding;

export type VariantResult = { ok: true; profile: ProfileDetail; variant: ProfileRuntimeVariant | null } | { ok: false; error: CutexRefusal };

// ---------- request bodies (main validates what the renderer sends) ----------

const VARIANT_ID = /^[a-z0-9-]{1,32}$/;

export function variantIdOf(id: unknown): string {
  if (typeof id !== "string" || !VARIANT_ID.test(id)) throw new Error("bad variant id");
  return id;
}

function runtimeOf(value: unknown): VariantRuntime {
  if (!(VARIANT_RUNTIMES as readonly unknown[]).includes(value)) throw new Error("bad runtime");
  return value as VariantRuntime;
}

function defaultsOf(value: unknown): Partial<VariantDefaults> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("bad variant defaults");
  const r = value as Record<string, unknown>;
  const out: Partial<VariantDefaults> = {};
  for (const key of ["model", "reasoningEffort"] as const) {
    if (!(key in r)) continue;
    const v = r[key];
    if (v === null || v === "") out[key] = null;
    else if (typeof v === "string" && v.trim().length <= 128 && !/[\u0000-\u001f\u007f]/.test(v)) out[key] = v.trim();
    else throw new Error(`bad ${key}`);
  }
  return out;
}

/** `POST /v2/profiles/{p}/variants`. */
export interface VariantAddRequest {
  runtime: VariantRuntime;
  id?: string;
  defaults?: Partial<VariantDefaults>;
  /** DSH only (profile-relay-runtimes): its own Anthropic-compatible address. */
  baseUrl?: string;
}

/** Plain http(s) address, matching cutex's interface URL contract. Never echo input in errors. */
export function variantBaseUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("bad variant base URL");
  const text = value.trim();
  if (!/^https?:\/\//i.test(text) || /[\s\u0000-\u001f\u007f-\u009f]/u.test(text)) throw new Error("bad variant base URL");
  let url: URL;
  try { url = new URL(text); } catch { throw new Error("bad variant base URL"); }
  if (!url.hostname || url.username || url.password || text.includes("?") || text.includes("#")) throw new Error("bad variant base URL");
  return text;
}

export function variantAddBody(input: unknown): VariantAddRequest {
  const r = (input ?? {}) as Record<string, unknown>;
  const body: VariantAddRequest = { runtime: runtimeOf(r.runtime) };
  if (r.id !== undefined) body.id = variantIdOf(r.id);
  const defaults = defaultsOf(r.defaults);
  if (Object.keys(defaults).length) body.defaults = defaults;
  if (r.baseUrl !== undefined) {
    if (body.runtime !== "dsh") throw new Error("only DSH has a variant base URL");
    body.baseUrl = variantBaseUrl(r.baseUrl);
  }
  return body;
}

/** `PATCH /v2/profiles/{p}/variants/{v}`. */
export function variantPatchBody(defaults: unknown): { defaults: Partial<VariantDefaults> } {
  const d = defaultsOf(defaults);
  if (!Object.keys(d).length) throw new Error("nothing to change");
  return { defaults: d };
}

/** Names cutex refuses for a DSH key variable (it validates again; this only spares a round trip). */
const RESERVED_ENV = /^(CUTEX_|NODE_|LD_|DYLD_|NPM_)|^(PATH|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|TMPDIR|SHELL|COMSPEC|SYSTEMROOT|DSH_PROFILE_API_KEY)$/i;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/** A host environment variable name for a DSH key (Advanced), or null. */
export function credentialEnvName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return ENV_NAME.test(name) && !RESERVED_ENV.test(name) ? name : null;
}

export type CredentialSourcePatch = { source: "stored" } | { source: "env"; envName: string };

export function credentialSourceBody(input: unknown): CredentialSourcePatch {
  const r = (input ?? {}) as Record<string, unknown>;
  if (r.source === "stored") return { source: "stored" };
  if (r.source === "env") {
    const envName = credentialEnvName(r.envName);
    if (!envName) throw new Error("bad environment variable name");
    return { source: "env", envName };
  }
  throw new Error("bad credential source");
}

/** A profile key (Codex API-key / DSH): trimmed, no whitespace or control characters; errors never repeat it. */
export function profileApiKey(value: unknown): string {
  if (typeof value !== "string") throw new Error("bad API key");
  const key = value.trim();
  if (!key || key.length > 4096 || /[\s\u0000-\u001f\u007f-\u009f]/u.test(key)) throw new Error("bad API key");
  return key;
}
