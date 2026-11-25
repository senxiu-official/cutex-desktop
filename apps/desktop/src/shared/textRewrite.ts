// 提示词增强 (prompt enhancement): cutex one-shot text rewrite, `POST /v2/text-rewrite` (feature `text-rewrite-v1`,
// cutex docs/text-rewrite.md, schema src/management/v2/schema/export/text-rewrite.json). The renderer asks main
// through two narrow methods (DaemonApi.textRewrite / cancelTextRewrite); main rebuilds the body from these known
// fields, calls cutex with the host credential and passes back only the fields below. The draft is never logged.

export const TEXT_REWRITE_FEATURE = "text-rewrite-v1";
export const PROMPT_ENHANCE_TEMPLATE = "prompt-enhance-v1";
/** cutex limit: nonblank text within 16 KiB of UTF-8. */
export const TEXT_REWRITE_MAX_BYTES = 16 * 1024;
/** cutex: at most four distinct candidates, the agent's own Profile included. */
export const TEXT_REWRITE_MAX_PROFILES = 4;

/**
 * agent: the session's own Profile, then backups: ordinary Profile IDs (`fallbackProfileIds`, hosts before
 * feature-profiles) or 功能 Profile IDs (`fallbackFeatureProfileIds`, shared/featureProfiles.ts), never both.
 * profile: an explicit ordinary list (hosts before feature-profiles). featureProfiles: 功能 Profiles only, in order.
 */
export type TextRewriteRoute =
  | { mode: "agent"; sessionId: string; fallbackProfileIds?: string[]; fallbackFeatureProfileIds?: string[] }
  | { mode: "profile"; profileIds: string[] }
  | { mode: "featureProfiles"; featureProfileIds: string[] };

export interface TextRewriteRequest {
  /** Chosen by the renderer; `cancelTextRewrite(requestId)` aborts this call (main closes the connection). */
  requestId: string;
  text: string;
  route: TextRewriteRoute;
}

export const TEXT_REWRITE_ATTEMPT_CATEGORIES = [
  "authentication", "quota_exhausted", "rate_limited", "profile_unavailable", "content_refused",
  "invalid_output", "timeout", "upstream", "cancelled",
] as const;
export type TextRewriteAttemptCategory = (typeof TEXT_REWRITE_ATTEMPT_CATEGORIES)[number];
export interface TextRewriteAttempt { profileId: string; category: TextRewriteAttemptCategory }

export interface TextRewriteUsed {
  profileId: string;
  provider: string;
  /** null when the provider did not report it. */
  model: string | null;
  requestedModel: string;
  fallbackUsed: boolean;
}

/** What the renderer can act on; anything else from cutex becomes `failed`. */
export const TEXT_REWRITE_ERROR_CODES = [
  "cancelled", "rewrite_failed", "rewrite_busy", "rewrite_input_too_large", "invalid_rewrite_request",
  "invalid_rewrite_route", "rewrite_profiles_unavailable", "unsupported", "forbidden", "unreachable", "timeout", "failed",
] as const;
export type TextRewriteErrorCode = (typeof TEXT_REWRITE_ERROR_CODES)[number];

export type TextRewriteResult =
  | { ok: true; rewrittenText: string; missingDetails: string[]; used: TextRewriteUsed }
  | { ok: false; code: TextRewriteErrorCode; attempts: TextRewriteAttempt[] };

const ID = /^[A-Za-z0-9._:@-]{1,200}$/;
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

export function isTextRewriteRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID.test(value);
}

function idList(value: unknown, what: string, min: number): string[] {
  if (value === undefined && min === 0) return [];
  if (!Array.isArray(value) || value.length < min || value.length > TEXT_REWRITE_MAX_PROFILES) throw new Error(`invalid ${what}`);
  const out: string[] = [];
  for (const id of value) {
    if (typeof id !== "string" || !ID.test(id)) throw new Error(`invalid ${what}`);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** The request body cutex gets, rebuilt from known fields. Throws on anything else (messages never quote the text). */
export function textRewriteBody(input: unknown): { templateId: string; text: string; route: TextRewriteRoute } {
  const v = input as Partial<TextRewriteRequest> | null;
  if (!v || typeof v !== "object") throw new Error("invalid text rewrite request");
  if (typeof v.text !== "string" || !v.text.trim()) throw new Error("empty text");
  if (utf8Bytes(v.text) > TEXT_REWRITE_MAX_BYTES) throw new Error("text too long");
  const r = v.route as Partial<Record<string, unknown>> | null | undefined;
  if (!r || typeof r !== "object") throw new Error("invalid route");
  let route: TextRewriteRoute;
  if (r.mode === "agent") {
    if (typeof r.sessionId !== "string" || !ID.test(r.sessionId)) throw new Error("invalid route");
    const fallback = idList(r.fallbackProfileIds, "fallback profiles", 0);
    const features = idList(r.fallbackFeatureProfileIds, "fallback feature profiles", 0);
    if (fallback.length && features.length) throw new Error("invalid route");
    route = features.length ? { mode: "agent", sessionId: r.sessionId, fallbackFeatureProfileIds: features.slice(0, TEXT_REWRITE_MAX_PROFILES - 1) }
      : fallback.length ? { mode: "agent", sessionId: r.sessionId, fallbackProfileIds: fallback.slice(0, TEXT_REWRITE_MAX_PROFILES - 1) }
      : { mode: "agent", sessionId: r.sessionId };
  } else if (r.mode === "profile") {
    route = { mode: "profile", profileIds: idList(r.profileIds, "profiles", 1) };
  } else if (r.mode === "featureProfiles") {
    route = { mode: "featureProfiles", featureProfileIds: idList(r.featureProfileIds, "feature profiles", 1) };
  } else throw new Error("invalid route");
  return { templateId: PROMPT_ENHANCE_TEMPLATE, text: v.text, route };
}

export function utf8Bytes(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/** A 200 reply, checked against the schema; null when it is not one. */
export function textRewriteReply(value: unknown): Extract<TextRewriteResult, { ok: true }> | null {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== "object" || v.contractVersion !== 2) return null;
  if (typeof v.rewrittenText !== "string" || !v.rewrittenText) return null;
  const details = Array.isArray(v.missingDetails) ? v.missingDetails.filter((x): x is string => typeof x === "string").slice(0, 12) : null;
  const u = v.used as Record<string, unknown> | null;
  if (!details || !u || typeof u !== "object") return null;
  if (typeof u.profileId !== "string" || !u.profileId || typeof u.provider !== "string" || typeof u.requestedModel !== "string") return null;
  if (u.model !== null && typeof u.model !== "string") return null;
  return {
    ok: true,
    rewrittenText: v.rewrittenText,
    missingDetails: details,
    used: { profileId: u.profileId, provider: u.provider, model: (u.model as string | null) ?? null, requestedModel: u.requestedModel, fallbackUsed: u.fallbackUsed === true },
  };
}

/** `error.details.attempts` of a `rewrite_failed` answer (unknown entries dropped). */
export function textRewriteAttempts(details: unknown): TextRewriteAttempt[] {
  const list = (details as { attempts?: unknown } | null | undefined)?.attempts;
  if (!Array.isArray(list)) return [];
  const out: TextRewriteAttempt[] = [];
  for (const a of list.slice(0, 8)) {
    const x = a as Partial<TextRewriteAttempt> | null;
    if (!x || typeof x.profileId !== "string" || !ID.test(x.profileId)) continue;
    if (!TEXT_REWRITE_ATTEMPT_CATEGORIES.includes(x.category as TextRewriteAttemptCategory)) continue;
    out.push({ profileId: x.profileId, category: x.category as TextRewriteAttemptCategory });
  }
  return out;
}

/** A cutex error code (and HTTP status) as one the renderer knows. */
export function textRewriteErrorCode(code: string, status: number): TextRewriteErrorCode {
  if ((TEXT_REWRITE_ERROR_CODES as readonly string[]).includes(code)) return code as TextRewriteErrorCode;
  if (status === 404 || status === 405 || code === "route_not_found" || code === "method_not_allowed") return "unsupported";
  if (status === 401 || status === 403) return "forbidden";
  if (status === 413) return "rewrite_input_too_large";
  return "failed";
}
