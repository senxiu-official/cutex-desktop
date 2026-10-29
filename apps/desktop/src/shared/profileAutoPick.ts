// cutex `profile-auto-pick` (docs/design/041-profile-auto-pick.md): `profile: "auto:<providerFamily>"`
// on `POST /v2/human/agents` lets cutex pick, among the profiles of that provider whose owner turned
// on 「参与自动选择」 (`autoPick`), the one whose first quota window runs out last. Never across
// providers. `GET /v2/profile-auto-pick` previews the ranking; the create response explains the pick
// (`profilePick`). Parsed defensively: anything malformed is dropped, never shown half.

export const PROFILE_AUTO_PICK_FEATURE = "profile-auto-pick";

/** The `profile` value asking for an automatic pick within `family`. */
export const autoProfile = (family: string): string => `auto:${family}`;

/** `auto:<family>` → family; anything else → null. */
export function autoFamily(profile: string | null | undefined): string | null {
  return profile && profile.startsWith("auto:") && profile.length > 5 ? profile.slice(5) : null;
}

export interface PickCandidate {
  profile: string;
  profileId: string;
  /** Hours until the first window hits its limit (capped at 24). */
  hours: number;
  bindingWindow: string | null;
  remainingPercent: number | null;
  resetAt: number | null;
  activeAgents: number;
}

export interface PickExcluded {
  profile: string;
  /** not_opted_in | requires_approval | no_subscription_windows | quota_stale | quota_read_failed (others shown raw). */
  reason: string;
}

export interface ProfilePick {
  requested: string;
  provider: string;
  picked: string;
  pickedId: string;
  /** latest_wall | tie_fewer_agents | tie_name | only_candidate | all_near_wall_soonest_reset. */
  rule: string;
  /** cutex's own one-line English reason (the UI builds its own from the fields). */
  reason: string;
  candidates: PickCandidate[];
  excluded: PickExcluded[];
}

export interface PickRefusal {
  code: string;
  detail: string;
}

export interface ProviderPick {
  provider: string;
  providerLabel: string;
  profiles: number;
  optedIn: number;
  pick: ProfilePick | null;
  refusal: PickRefusal | null;
}

export interface AutoPickPreview {
  /** false while a profile still has a reserved name (`unavailableReason` says which). */
  available: boolean;
  unavailableReason: string | null;
  providers: ProviderPick[];
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown, max = 300): string | null => (typeof v === "string" && v.length <= max ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function candidateOf(raw: unknown): PickCandidate | null {
  const r = obj(raw);
  const profile = str(r?.profile, 200), profileId = str(r?.profileId, 200), hours = num(r?.hours);
  if (!r || !profile || !profileId || hours === null) return null;
  return { profile, profileId, hours, bindingWindow: str(r.bindingWindow, 40), remainingPercent: num(r.remainingPercent), resetAt: num(r.resetAt), activeAgents: Math.max(0, Math.trunc(num(r.activeAgents) ?? 0)) };
}

/** `profilePick` of a create response / preview entry; null when absent or malformed. */
export function profilePickOf(raw: unknown): ProfilePick | null {
  const r = obj(raw);
  const requested = str(r?.requested, 200), provider = str(r?.provider, 200), picked = str(r?.picked, 200), pickedId = str(r?.pickedId, 200);
  if (!r || !requested || !provider || !picked || !pickedId) return null;
  const list = <T>(v: unknown, of: (x: unknown) => T | null): T[] => (Array.isArray(v) ? v.slice(0, 50).map(of).filter((x): x is T => x !== null) : []);
  const excluded = list(r.excluded, (x) => {
    const e = obj(x);
    const profile = str(e?.profile, 200), reason = str(e?.reason, 80);
    return profile && reason ? { profile, reason } : null;
  });
  return { requested, provider, picked, pickedId, rule: str(r.rule, 80) ?? "latest_wall", reason: str(r.reason, 500) ?? "", candidates: list(r.candidates, candidateOf), excluded };
}

/** `GET /v2/profile-auto-pick` body; null when it is not one. */
export function autoPickPreviewOf(raw: unknown): AutoPickPreview | null {
  const r = obj(raw);
  if (!r || !Array.isArray(r.providers)) return null;
  const providers = r.providers.slice(0, 50).flatMap((x): ProviderPick[] => {
    const e = obj(x);
    const provider = str(e?.provider, 200);
    if (!e || !provider) return [];
    const refusal = obj(e.refusal);
    const code = str(refusal?.code, 80);
    return [{
      provider,
      providerLabel: str(e.providerLabel, 200) ?? provider,
      profiles: Math.max(0, Math.trunc(num(e.profiles) ?? 0)),
      optedIn: Math.max(0, Math.trunc(num(e.optedIn) ?? 0)),
      pick: profilePickOf(e.profilePick),
      refusal: code ? { code, detail: str(refusal?.detail, 2000) ?? "" } : null,
    }];
  });
  return { available: r.available !== false, unavailableReason: str(r.unavailableReason, 2000), providers };
}

/** Query of `GET /v2/profile-auto-pick` (empty values left out). */
export function autoPickQuery(query: { provider?: string | null; model?: string | null; effort?: string | null }): string {
  const params = new URLSearchParams();
  for (const key of ["provider", "model", "effort"] as const) {
    const value = query[key]?.trim();
    if (value) params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** The provider's terms page shown beside the 「参与自动选择」 switch (041 §5); null = none known. */
export function providerTermsUrl(family: string | null | undefined): string | null {
  switch (family) {
    case "anthropic":
    case "claude":
      return "https://www.anthropic.com/legal/consumer-terms";
    case "openai-chatgpt":
    case "openai-api":
      return "https://openai.com/policies/row-terms-of-use/";
    case "zhipu":
      return "https://docs.z.ai/legal-agreement/subscription-terms";
    default:
      return null;
  }
}

/**
 * Whether the New-agent page offers 「自动」 for a provider: the host has the capability, the pick is
 * available, and the provider has at least two profiles of which one is opted in (one profile: it is
 * simply that profile).
 */
export function offersAuto(entry: Pick<ProviderPick, "profiles" | "optedIn"> | null | undefined, preview: Pick<AutoPickPreview, "available"> | null): boolean {
  return !!entry && !!preview?.available && entry.profiles >= 2 && entry.optedIn >= 1;
}
