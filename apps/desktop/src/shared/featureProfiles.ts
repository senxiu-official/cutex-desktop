// 功能 Profile (Feature Profiles; owner 2026-11-25): lightweight model endpoints that only app features use (first:
// 提示词增强), never agents. cutex `feature-profiles` (features.featureProfiles), docs/management/feature-profiles.md
// and feature-profiles-desktop.md: `/v2/feature-profiles` (owner credential only), a host-local owner-private store.
// The API key is write-only: the renderer sends it once (create / replace) through main; reads carry `keyPresent`
// only, and main returns nothing but the parsed view below (never the request body). Parsers are tolerant: unknown
// fields are ignored, an unknown protocol / quota type is kept as text so a newer host still lists its rows.

export const FEATURE_PROFILES_FEATURE = "feature-profiles";

export const FEATURE_PROFILE_PROTOCOLS = ["openaiResponses", "anthropicMessages"] as const;
export type FeatureProfileProtocol = (typeof FEATURE_PROFILE_PROTOCOLS)[number];

/** Display only (cutex never meters it): 订阅窗口 · 周期额度 · 余额 · 按量付费. */
export const FEATURE_PROFILE_QUOTA_TYPES = ["subscriptionWindow", "periodicAllowance", "balance", "payAsYouGo"] as const;
export type FeatureProfileQuotaType = (typeof FEATURE_PROFILE_QUOTA_TYPES)[number];

export interface FeatureProfile {
  id: string;
  name: string;
  /** A known protocol, or the host's own word for a newer one (shown as is, not editable here). */
  protocol: string;
  baseUrl: string;
  model: string;
  quotaType: string;
  keyPresent: boolean;
}

export interface FeatureProfileCreate {
  name: string;
  protocol: FeatureProfileProtocol;
  baseUrl: string;
  model: string;
  quotaType: FeatureProfileQuotaType;
  apiKey: string;
}

/** Only the changed fields; `apiKey` only when the owner replaces the key. */
export type FeatureProfilePatch = Partial<FeatureProfileCreate>;

/** cutex: at most 64 characters of name; model without whitespace, 256 bytes. */
export const FEATURE_PROFILE_NAME_MAX = 64;
export const FEATURE_PROFILE_MODEL_MAX = 256;
/** cutex keeps at most 128 per host. */
export const FEATURE_PROFILE_LIMIT = 128;

const ID = /^[A-Za-z0-9._:@-]{1,200}$/;
const str = (v: unknown) => (typeof v === "string" ? v : null);

/** One row of a cutex view; null when it is not one. */
export function parseFeatureProfile(value: unknown): FeatureProfile | null {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== "object") return null;
  const id = str(v.id), name = str(v.name);
  if (!id || !ID.test(id) || !name) return null;
  return {
    id,
    name,
    protocol: str(v.protocol) ?? "",
    baseUrl: str(v.baseUrl) ?? "",
    model: str(v.model) ?? "",
    quotaType: str(v.quotaType) ?? "",
    keyPresent: v.keyPresent === true,
  };
}

/** The list: readable rows, and the IDs of records the host could not read (`errors`, e.g.
 *  invalid_feature_profile_record). Damaged ones are only shown (and deletable) in Settings, never offered for rewrite. */
export interface FeatureProfileListView {
  profiles: FeatureProfile[];
  damaged: string[];
}

/** `GET /v2/feature-profiles` → its rows (malformed ones dropped) and damaged record IDs (any error code; no errors = none). */
export function parseFeatureProfileList(value: unknown): FeatureProfileListView {
  const v = value as { profiles?: unknown; errors?: unknown } | null;
  if (!Array.isArray(v?.profiles)) throw new Error("invalid feature profile list");
  const profiles = v.profiles.map(parseFeatureProfile).filter((p): p is FeatureProfile => p !== null);
  const readable = new Set(profiles.map((p) => p.id));
  const damaged: string[] = [];
  for (const e of Array.isArray(v.errors) ? v.errors : []) {
    const id = (e as { id?: unknown } | null)?.id;
    if (isFeatureProfileId(id) && !readable.has(id) && !damaged.includes(id)) damaged.push(id);
  }
  return { profiles, damaged };
}

/** `{profile}` of a POST / PATCH / GET one. */
export function parseFeatureProfileReply(value: unknown): FeatureProfile {
  const p = parseFeatureProfile((value as { profile?: unknown } | null)?.profile);
  if (!p) throw new Error("invalid feature profile reply");
  return p;
}

export function isFeatureProfileId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

function field(input: Record<string, unknown>, key: keyof FeatureProfileCreate, required: boolean): string | undefined {
  const v = input[key];
  if (v === undefined && !required) return undefined;
  if (typeof v !== "string") throw new Error(`invalid ${key}`);
  if (key === "protocol" && !(FEATURE_PROFILE_PROTOCOLS as readonly string[]).includes(v)) throw new Error("invalid protocol");
  if (key === "quotaType" && !(FEATURE_PROFILE_QUOTA_TYPES as readonly string[]).includes(v)) throw new Error("invalid quotaType");
  if (!v.trim()) throw new Error(`invalid ${key}`);
  return v.trim();
}

const KEYS: readonly (keyof FeatureProfileCreate)[] = ["name", "protocol", "baseUrl", "model", "quotaType", "apiKey"];

/** The POST body, rebuilt from known fields (messages never quote the key). */
export function featureProfileCreateBody(input: unknown): FeatureProfileCreate {
  const v = input as Record<string, unknown> | null;
  if (!v || typeof v !== "object") throw new Error("invalid feature profile");
  const out = {} as Record<string, string>;
  for (const k of KEYS) out[k] = field(v, k, true)!;
  return out as unknown as FeatureProfileCreate;
}

/** The PATCH body: only the known fields given (cutex refuses an empty patch and nulls). */
export function featureProfilePatchBody(input: unknown): FeatureProfilePatch {
  const v = input as Record<string, unknown> | null;
  if (!v || typeof v !== "object") throw new Error("invalid feature profile patch");
  const out: Record<string, string> = {};
  for (const k of KEYS) {
    const x = field(v, k, false);
    if (x !== undefined) out[k] = x;
  }
  if (!Object.keys(out).length) throw new Error("empty feature profile patch");
  return out as FeatureProfilePatch;
}
