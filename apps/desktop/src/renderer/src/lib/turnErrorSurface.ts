// Turn-error surface (cutex `turn-error-surface`, contract 2026-11-04): a session whose last turn ended
// `failed` carries `activity.lastTurnError` on its resource (null once a later turn completes). The agent
// list shows a small error badge, the conversation header a banner with a localized summary, a link to the
// failed turn and — only when an unauthorized-family failure repeats — a way to the Profile's login.
// Older hosts (no feature) show nothing new; the timeline's red TurnErrorRow is unchanged either way.
import type { SessionResource } from "@cutex-desktop/protocol";
import type { MessageKey } from "../i18n";

export const TURN_ERROR_SURFACE_FEATURE = "turn-error-surface";
/** The camelCase spelling of the same capability (host `(kebab, camel)` table). */
const TURN_ERROR_SURFACE_FEATURE_CAMEL = "turnErrorSurface";

export interface LastTurnError {
  turnId: string;
  message: string;
  /** Stable lowercase code: `refresh_token_reused`, `unauthorized`, a codexErrorInfo name, or `other`. */
  code: string;
  codexErrorInfo: unknown;
  at: string | null;
  /** Consecutive failed turns ending with this one (1 = the first). */
  consecutive: number;
}

export function turnErrorSurfaceOn(features: ReadonlySet<string> | null | undefined): boolean {
  return !!features && (features.has(TURN_ERROR_SURFACE_FEATURE) || features.has(TURN_ERROR_SURFACE_FEATURE_CAMEL));
}

/** The session's `activity.lastTurnError`, null when absent / null / malformed. */
export function lastTurnErrorOf(session: Pick<SessionResource, "activity"> | null | undefined): LastTurnError | null {
  const raw = session?.activity?.lastTurnError;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.turnId !== "string" || !r.turnId) return null;
  const consecutive = typeof r.consecutive === "number" && Number.isFinite(r.consecutive) && r.consecutive >= 1 ? Math.floor(r.consecutive) : 1;
  return {
    turnId: r.turnId,
    message: typeof r.message === "string" ? r.message : "",
    code: typeof r.code === "string" && r.code ? r.code : "other",
    codexErrorInfo: r.codexErrorInfo ?? null,
    at: typeof r.at === "string" ? r.at : null,
    consecutive,
  };
}

/** Codes that mean the Profile's login was refused (a re-login may help when it repeats). */
const UNAUTHORIZED_FAMILY: ReadonlySet<string> = new Set(["unauthorized", "refresh_token_reused"]);

export const isUnauthorizedFamily = (e: Pick<LastTurnError, "code">): boolean => UNAUTHORIZED_FAMILY.has(e.code);

/** Re-login is offered only when an unauthorized-family failure repeats (a single refresh clash retries by itself). */
export const offersRelogin = (e: Pick<LastTurnError, "code" | "consecutive">): boolean => isUnauthorizedFamily(e) && e.consecutive >= 2;

/** Longest error message the banner shows inline (the full text is its tooltip). */
export const TURN_ERROR_MESSAGE_MAX = 160;

export function truncateMessage(message: string, max = TURN_ERROR_MESSAGE_MAX): string {
  const line = message.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** The reason part of the summary: the localized wording for known codes, else the (truncated) message. */
export function turnErrorReason(t: Translate, e: LastTurnError): string {
  if (e.code === "refresh_token_reused") return t("turnError.refreshTokenReused");
  if (e.code === "unauthorized") return t(e.consecutive >= 2 ? "turnError.unauthorizedRepeated" : "turnError.unauthorized");
  return truncateMessage(e.message) || e.code;
}

/** One line: 「上一回合失败：…」, or 「连续 N 个回合失败：…」 when it repeats. */
export function turnErrorSummary(t: Translate, e: LastTurnError): string {
  const reason = turnErrorReason(t, e);
  return e.consecutive >= 2 ? t("turnError.repeatedWithReason", { n: e.consecutive, reason }) : t("turnError.withReason", { reason });
}
