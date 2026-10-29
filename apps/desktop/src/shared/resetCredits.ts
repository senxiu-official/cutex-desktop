// Usage-limit reset credits (额度重置券, cutex `profile-reset-credits`, docs/design/012-reset-credits.md):
// wire shapes of `GET /v2/profiles/{p}/reset-credits[?refresh=true]` and
// `POST /v2/profiles/{p}/reset-credits/consume {idempotencyKey, creditId?}`, plus the pure helpers the
// main process and renderer share.

export const RESET_CREDITS_FEATURE = "profile-reset-credits";

export type ResetCreditsProvider = "codex" | "claude" | "glm";
/** apiKey: API-key login / Claude API account; zcodeOnly: GLM / Z.ai (ZCode login needed); provider: none known. */
export type ResetCreditsUnsupported = "apiKey" | "zcodeOnly" | "provider";

export interface ResetCredit {
  id: string;
  title: string | null;
  description: string | null;
  /** available | paused (Claude) | redeeming … */
  status: string;
  /** Unix seconds. */
  grantedAt: number | null;
  expiresAt: number | null;
  /** Uses left on this credit (Codex: 1; a Claude grant can hold several). */
  resetsLeft: number;
  resetsTotal?: number | null;
  usableNow?: boolean;
}

export interface ResetCreditsView {
  profile: { id: string; name: string };
  provider: ResetCreditsProvider | null;
  supported: boolean;
  unsupportedReason: ResetCreditsUnsupported | null;
  /** null = unknown (read failed / not read yet). */
  availableCount: number | null;
  credits: ResetCredit[];
  /** false: rows may be fewer than availableCount (Codex caps the list, or only the count is known). */
  detailsComplete: boolean;
  fetchedAt: number | null;
  error: string | null;
  account?: { id: string };
  /** Claude: the server offers limit resets to this login at all. */
  offered?: boolean;
  eligible?: boolean;
  ineligibleReason?: string | null;
  atLimit?: boolean;
  cooldownUntil?: number | null;
}

export type ResetOutcome = "reset" | "nothingToReset" | "noCredit" | "alreadyRedeemed" | "cooldown" | "ineligible" | "unavailable";

export interface ResetConsumeResult {
  outcome: ResetOutcome;
  reason?: string | null;
  resetsLeft?: number | null;
}

const OUTCOMES: readonly ResetOutcome[] = ["reset", "nothingToReset", "noCredit", "alreadyRedeemed", "cooldown", "ineligible", "unavailable"];

/** Coerce cutex's reply (unknown outcome → unavailable). */
export function consumeResultOf(raw: unknown): ResetConsumeResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const outcome = OUTCOMES.includes(r.outcome as ResetOutcome) ? (r.outcome as ResetOutcome) : "unavailable";
  return {
    outcome,
    reason: typeof r.reason === "string" ? r.reason : null,
    resetsLeft: typeof r.resetsLeft === "number" ? r.resetsLeft : null,
  };
}

/** Normalize a view (old / partial replies stay safe to render). */
export function resetCreditsViewOf(raw: unknown): ResetCreditsView | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const profile = r.profile as { id?: unknown; name?: unknown } | undefined;
  if (!profile || typeof profile.name !== "string") return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const credits = Array.isArray(r.credits)
    ? r.credits.flatMap((c): ResetCredit[] => {
        const x = (c ?? {}) as Record<string, unknown>;
        if (typeof x.id !== "string") return [];
        return [{
          id: x.id,
          title: typeof x.title === "string" ? x.title : null,
          description: typeof x.description === "string" ? x.description : null,
          status: typeof x.status === "string" ? x.status : "available",
          grantedAt: num(x.grantedAt),
          expiresAt: num(x.expiresAt),
          resetsLeft: num(x.resetsLeft) ?? 1,
          resetsTotal: num(x.resetsTotal),
          ...(typeof x.usableNow === "boolean" ? { usableNow: x.usableNow } : {}),
        }];
      })
    : [];
  return {
    profile: { id: typeof profile.id === "string" ? profile.id : profile.name, name: profile.name },
    provider: r.provider === "codex" || r.provider === "claude" || r.provider === "glm" ? r.provider : null,
    supported: r.supported === true,
    unsupportedReason: r.unsupportedReason === "apiKey" || r.unsupportedReason === "zcodeOnly" || r.unsupportedReason === "provider" ? r.unsupportedReason : null,
    availableCount: num(r.availableCount),
    credits,
    detailsComplete: r.detailsComplete === true,
    fetchedAt: num(r.fetchedAt),
    error: typeof r.error === "string" ? r.error : null,
    ...(r.account && typeof (r.account as { id?: unknown }).id === "string" ? { account: { id: (r.account as { id: string }).id } } : {}),
    ...(typeof r.offered === "boolean" ? { offered: r.offered } : {}),
    ...(typeof r.eligible === "boolean" ? { eligible: r.eligible } : {}),
    ...(typeof r.ineligibleReason === "string" ? { ineligibleReason: r.ineligibleReason } : {}),
    ...(typeof r.atLimit === "boolean" ? { atLimit: r.atLimit } : {}),
    ...(num(r.cooldownUntil) !== null ? { cooldownUntil: num(r.cooldownUntil) } : {}),
  };
}

/** Credits that can be used now (not paused), soonest expiry first; undated last. */
export function usableCredits(view: ResetCreditsView): ResetCredit[] {
  return view.credits
    .filter((c) => c.status === "available" && c.resetsLeft > 0)
    .sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity));
}

/** The soonest expiry among usable credits (unix s), null when none is dated. */
export function soonestExpiry(view: ResetCreditsView): number | null {
  return usableCredits(view).find((c) => c.expiresAt !== null)?.expiresAt ?? null;
}

/** There is something to use: a known count above 0 (rows may be capped). */
export function hasResetCredits(view: ResetCreditsView | null | undefined): boolean {
  return !!view && view.supported && (view.availableCount ?? 0) > 0;
}

/** Which credit a 「用一张」 click uses: the soonest-expiring usable one (null = let the server pick). */
export function creditToUse(view: ResetCreditsView): string | null {
  return usableCredits(view)[0]?.id ?? null;
}

/** Idempotency key for one click (retries of that click reuse it). */
export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `rc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function validIdempotencyKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{8,64}$/.test(key);
}
