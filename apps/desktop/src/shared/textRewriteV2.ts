// 输入优化 (input-refinement) v2 (cutex `text-rewrite-v2`, runtime-isolation-study docs/text-rewrite-v2.md): templates kept on the host
// (two built-ins plus the owner's copies) and one structured call that returns the rewrite, checkable suggestions
// and, for correction templates, the changes with a category, a one-line explanation and the meanings they depend on.
// Like v1 (shared/textRewrite.ts) the renderer asks main through narrow methods; main rebuilds every body from the
// known fields below, calls cutex with the host credential and passes back only the parsed view. Drafts are never logged.
import { TEXT_REWRITE_MAX_BYTES, TEXT_REWRITE_MAX_PROFILES, isTextRewriteRequestId, utf8Bytes, type TextRewriteAttempt, type TextRewriteErrorCode, type TextRewriteUsed } from "./textRewrite";

export const TEXT_REWRITE_V2_FEATURE = "text-rewrite-v2";
/** cutex r298: one global Profile order (`/v2/text-rewrite/route`); templates follow it unless they set their own. */
export const TEXT_REWRITE_GLOBAL_ROUTE_FEATURE = "text-rewrite-global-route";
/**
 * Built-in template IDs (stable; the desktop names them in its own language while they are built-ins). r297 hosts
 * ship 提示词增强 and 纠错学习; r298 ships only 语法纠错, and an upgraded host keeps the two old IDs as owner templates
 * (builtIn false, the host's names).
 */
export const BUILTIN_ENHANCE_TEMPLATE = "prompt-enhance-v1";
export const BUILTIN_CORRECTION_TEMPLATE = "grammar-learning-v1";
export const BUILTIN_GRAMMAR_TEMPLATE = "grammar-correction-v1";
export const BUILTIN_TEMPLATES = [BUILTIN_GRAMMAR_TEMPLATE, BUILTIN_ENHANCE_TEMPLATE, BUILTIN_CORRECTION_TEMPLATE] as const;

/** cutex: the previous / returned draft each within 24 KiB; 12 suggestions, 24 corrections. */
export const TEXT_REWRITE_V2_MAX_RESULT_BYTES = 24 * 1024;
export const TEXT_REWRITE_MAX_SUGGESTIONS = 12;
export const TEXT_REWRITE_MAX_CORRECTIONS = 24;
/** Desktop-side bounds for what the owner types into a template (cutex checks its own). */
export const REWRITE_TEMPLATE_NAME_MAX = 64;
export const REWRITE_TEMPLATE_PROMPT_MAX_BYTES = 16 * 1024;
/** cutex keeps at most this many owner templates per host (the built-ins not counted). */
export const REWRITE_TEMPLATE_MAX_CUSTOM = 32;
/** Template POST / PATCH refusals with their own wording (cutex 409 / 400; the code survives the IPC hop in the message). */
export const REWRITE_TEMPLATE_ERROR_CODES = ["rewrite_template_name_too_long", "rewrite_template_prompt_too_long", "rewrite_template_capacity"] as const;
export type RewriteTemplateErrorCode = (typeof REWRITE_TEMPLATE_ERROR_CODES)[number];

/** Which of the codes above a failed template call carries, if any. */
export function rewriteTemplateErrorOf(error: unknown): RewriteTemplateErrorCode | null {
  const message = error instanceof Error ? error.message : String(error);
  return REWRITE_TEMPLATE_ERROR_CODES.find((code) => new RegExp(`\\b${code}\\b`).test(message)) ?? null;
}

export const REWRITE_ANSWER_MAX_CHARS = 2000;
/**
 * cutex r297 `protection`: opaque to the desktop (cutex: ≤ 1,024 literals, 32 KiB of literal UTF-8; JSON escaping can
 * roughly double that). Bound on the serialised object both ways; a larger one is not kept or sent.
 */
export const REWRITE_PROTECTION_MAX_BYTES = 96 * 1024;

/**
 * What cutex protected (links, code, paths, mentions) in this round and the earlier ones. Opaque: carried unchanged
 * from a reply to the next 重新整理 of that version, never shown, never logged.
 */
export type RewriteProtection = { readonly [key: string]: unknown };

/** A plain JSON object within the bound, rebuilt by a JSON round trip (nothing but data); else null. */
export function protectionOf(value: unknown): RewriteProtection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const json = JSON.stringify(value);
    if (utf8Bytes(json) > REWRITE_PROTECTION_MAX_BYTES) return null;
    const copy = JSON.parse(json) as unknown;
    return copy && typeof copy === "object" && !Array.isArray(copy) ? (copy as RewriteProtection) : null;
  } catch {
    return null;
  }
}

export type RewriteTemplateKind = "enhance" | "correction";
export const REWRITE_TEMPLATE_KINDS: readonly RewriteTemplateKind[] = ["enhance", "correction"];

/** One Profile of a route: an ordinary Profile or a 功能 Profile; `model` null / absent = its rewrite default. */
export interface RewriteCandidate { kind: "profile" | "featureProfile"; profileId: string; model?: string | null }

/** profiles: these in order. agent: the conversation's own Profile (its model), then `fallback` in order. */
export type RewriteTemplateRoute =
  | { mode: "profiles"; candidates: RewriteCandidate[] }
  | { mode: "agent"; model: null; fallback: RewriteCandidate[] };

export interface RewriteTemplate {
  id: string;
  builtIn: boolean;
  kind: RewriteTemplateKind;
  name: string;
  prompt: string;
  /** The route its calls use (r298: its own, or the global order it follows). */
  route: RewriteTemplateRoute;
  /** r298 (text-rewrite-global-route): its own route, null = follows the global order; absent on older hosts. */
  routeOverride?: RewriteTemplateRoute | null;
}

/** `route` null (r298 hosts only): follow the global order (sent without a route). */
export interface RewriteTemplateCreate { kind: RewriteTemplateKind; name: string; prompt: string; route: RewriteTemplateRoute | null }
/** Built-ins take only `route`; `route: null` restores a built-in's default. */
export interface RewriteTemplatePatch { name?: string; prompt?: string; route?: RewriteTemplateRoute | null }

export interface RewriteSuggestion { id: string; text: string; needsInput: boolean }

export const CORRECTION_CATEGORIES = ["tense", "mood", "agreement", "spelling", "accent", "wordChoice", "punctuation", "grammar", "other"] as const;
export type CorrectionCategory = (typeof CORRECTION_CATEGORIES)[number];

/** [start, end) UTF-16 offsets into the original text, and the text there. */
export interface RewriteSpan { start: number; end: number; original: string }

/**
 * 取决于你的意思: another replacement and when it is the right one. `span` (cutex r297): a wider stretch of the
 * original that contains the change (e.g. 「je pense que je pouvais」 → 「je pensais que je pouvais」); absent = the
 * change's own span. Picking a wider one replaces that whole stretch and leaves out the changes it overlaps.
 */
export interface RewriteAlternative { replacement: string; when: string; span?: RewriteSpan }

/** One change of a correction template: [start, end) are UTF-16 offsets into the original text. */
export interface RewriteCorrection {
  start: number;
  end: number;
  original: string;
  replacement: string;
  category: CorrectionCategory;
  explanation: string;
  /** The language corrected (e.g. "fr"). */
  language: string;
  /** 取决于你的意思: other replacements (of this span or a wider one) and when each is the right one. */
  alternatives: RewriteAlternative[];
}

export interface StructuredRewriteRequest {
  /** Chosen by the renderer; `cancelTextRewrite(requestId)` aborts it like a v1 call. */
  requestId: string;
  templateId: string;
  /** The conversation (agent route); absent for a draft without an agent. */
  sessionId?: string;
  uiLanguage: string;
  /** Always the original draft (or selection). */
  text: string;
  /** 重新整理: the previous answer and the checked suggestions (with what the owner typed). */
  followUp?: { previous: { text: string; suggestions: RewriteSuggestion[] }; answers: { id: string; text?: string }[] };
  /** 重新整理 only: the `protection` of the version it builds on, unchanged (absent when that reply had none). */
  protection?: RewriteProtection;
}

export type StructuredRewriteResult =
  | {
    ok: true; text: string; suggestions: RewriteSuggestion[]; corrections: RewriteCorrection[]; used: TextRewriteUsed;
    /** cutex r297: how many of the model's changes it left out (not matching the text, overlapping); absent = none. */
    droppedCorrections?: number;
    /** cutex r297: carry to the next 重新整理 of this version; absent on older hosts. */
    protection?: RewriteProtection;
  }
  | { ok: false; code: TextRewriteErrorCode; attempts: TextRewriteAttempt[] };

const ID = /^[A-Za-z0-9._:@-]{1,200}$/;
const MODEL = /^\S{1,200}$/;
const LANG = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,3}$/;

export function isRewriteTemplateId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

// ── Bodies (main rebuilds them; throws on anything else, messages never quote text) ───────────────

function candidate(value: unknown): RewriteCandidate {
  const c = value as Partial<RewriteCandidate> | null;
  if (!c || typeof c !== "object" || (c.kind !== "profile" && c.kind !== "featureProfile") || typeof c.profileId !== "string" || !ID.test(c.profileId)) throw new Error("invalid route");
  if (c.model !== undefined && c.model !== null && c.model !== "" && (typeof c.model !== "string" || !MODEL.test(c.model))) throw new Error("invalid route");
  return c.model ? { kind: c.kind, profileId: c.profileId, model: c.model } : { kind: c.kind, profileId: c.profileId };
}

function candidates(value: unknown, min: number, max: number): RewriteCandidate[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error("invalid route");
  const out = value.map(candidate);
  if (new Set(out.map((c) => `${c.kind}\u0000${c.profileId}`)).size !== out.length) throw new Error("invalid route");
  return out;
}

export function rewriteRouteBody(value: unknown): RewriteTemplateRoute {
  const r = value as { mode?: unknown; candidates?: unknown; fallback?: unknown } | null;
  if (!r || typeof r !== "object") throw new Error("invalid route");
  if (r.mode === "profiles") return { mode: "profiles", candidates: candidates(r.candidates, 1, TEXT_REWRITE_MAX_PROFILES) };
  if (r.mode === "agent") return { mode: "agent", model: null, fallback: candidates(r.fallback ?? [], 0, TEXT_REWRITE_MAX_PROFILES - 1) };
  throw new Error("invalid route");
}

function name(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || [...value].length > REWRITE_TEMPLATE_NAME_MAX) throw new Error("invalid template name");
  return value;
}

function prompt(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || utf8Bytes(value) > REWRITE_TEMPLATE_PROMPT_MAX_BYTES) throw new Error("invalid template prompt");
  return value;
}

export function rewriteTemplateCreateBody(input: unknown): RewriteTemplateCreate {
  const v = input as Partial<RewriteTemplateCreate> | null;
  if (!v || typeof v !== "object" || !REWRITE_TEMPLATE_KINDS.includes(v.kind as RewriteTemplateKind)) throw new Error("invalid template");
  const out: RewriteTemplateCreate = { kind: v.kind as RewriteTemplateKind, name: name(v.name), prompt: prompt(v.prompt), route: null };
  if (v.route === undefined || v.route === null) {
    const { route: _, ...follow } = out;
    return follow as RewriteTemplateCreate; // no route: the template follows the global order (r298)
  }
  return { ...out, route: rewriteRouteBody(v.route) };
}

/** PATCH `/v2/text-rewrite/route`: `{route}` rebuilt from known fields. */
export function rewriteGlobalRouteBody(route: unknown): { route: RewriteTemplateRoute } {
  return { route: rewriteRouteBody(route) };
}

/** GET / PATCH `/v2/text-rewrite/route` replies. */
export function parseRewriteGlobalRouteReply(value: unknown): RewriteTemplateRoute {
  const v = value as { contractVersion?: unknown; route?: unknown } | null;
  const route = v && typeof v === "object" && v.contractVersion === 2 ? routeView(v.route) : null;
  if (!route) throw new Error("invalid rewrite route reply");
  return route;
}

export function rewriteTemplatePatchBody(input: unknown): RewriteTemplatePatch {
  const v = input as Partial<Record<keyof RewriteTemplatePatch, unknown>> | null;
  if (!v || typeof v !== "object") throw new Error("invalid template patch");
  const out: RewriteTemplatePatch = {};
  if (v.name !== undefined) out.name = name(v.name);
  if (v.prompt !== undefined) out.prompt = prompt(v.prompt);
  if (v.route !== undefined) out.route = v.route === null ? null : rewriteRouteBody(v.route);
  if (!Object.keys(out).length) throw new Error("invalid template patch");
  return out;
}

function suggestionBody(value: unknown): RewriteSuggestion {
  const s = value as Partial<RewriteSuggestion> | null;
  if (!s || typeof s !== "object" || typeof s.id !== "string" || !ID.test(s.id) || typeof s.text !== "string" || !s.text.trim() || typeof s.needsInput !== "boolean") throw new Error("invalid follow-up");
  return { id: s.id, text: s.text, needsInput: s.needsInput };
}

/** The `/v2/text-rewrite/structured` body, rebuilt from known fields (requestId stays in main). */
export function structuredRewriteBody(input: unknown): Omit<StructuredRewriteRequest, "requestId"> {
  const v = input as Partial<StructuredRewriteRequest> | null;
  if (!v || typeof v !== "object" || !isTextRewriteRequestId(v.requestId)) throw new Error("invalid text rewrite request");
  if (!isRewriteTemplateId(v.templateId)) throw new Error("invalid template");
  if (typeof v.text !== "string" || !v.text.trim()) throw new Error("empty text");
  if (utf8Bytes(v.text) > TEXT_REWRITE_MAX_BYTES) throw new Error("text too long");
  if (typeof v.uiLanguage !== "string" || !LANG.test(v.uiLanguage)) throw new Error("invalid language");
  if (v.sessionId !== undefined && (typeof v.sessionId !== "string" || !ID.test(v.sessionId))) throw new Error("invalid session");
  const body: Omit<StructuredRewriteRequest, "requestId"> = { templateId: v.templateId, uiLanguage: v.uiLanguage, text: v.text, ...(v.sessionId ? { sessionId: v.sessionId } : {}) };
  if (v.followUp !== undefined) {
    const f = v.followUp as Partial<NonNullable<StructuredRewriteRequest["followUp"]>> | null;
    const prev = f?.previous as Partial<NonNullable<StructuredRewriteRequest["followUp"]>["previous"]> | undefined;
    if (!f || typeof f !== "object" || !prev || typeof prev !== "object" || typeof prev.text !== "string" || !prev.text.trim()
      || utf8Bytes(prev.text) > TEXT_REWRITE_V2_MAX_RESULT_BYTES || !Array.isArray(prev.suggestions) || prev.suggestions.length > TEXT_REWRITE_MAX_SUGGESTIONS
      || !Array.isArray(f.answers) || !f.answers.length) throw new Error("invalid follow-up");
    const suggestions = prev.suggestions.map(suggestionBody);
    const known = new Set(suggestions.map((s) => s.id));
    const seen = new Set<string>();
    const answers = f.answers.map((a) => {
      const x = a as { id?: unknown; text?: unknown } | null;
      if (!x || typeof x.id !== "string" || !known.has(x.id) || seen.has(x.id)) throw new Error("invalid follow-up");
      seen.add(x.id);
      if (x.text === undefined) return { id: x.id };
      if (typeof x.text !== "string" || [...x.text].length > REWRITE_ANSWER_MAX_CHARS) throw new Error("invalid follow-up");
      return x.text.trim() ? { id: x.id, text: x.text } : { id: x.id };
    });
    body.followUp = { previous: { text: prev.text, suggestions }, answers };
  }
  if (v.protection !== undefined && v.protection !== null) {
    // Only a follow-up carries it (a new rewrite starts without), and only a bounded plain object.
    const protection = body.followUp ? protectionOf(v.protection) : null;
    if (!protection) throw new Error("invalid protection");
    body.protection = protection;
  }
  return body;
}

// ── Replies (anything malformed is dropped or becomes `failed`) ───────────────────────────────────

function routeView(value: unknown): RewriteTemplateRoute | null {
  try { return rewriteRouteBody(value); } catch { return null; }
}

export function parseRewriteTemplate(value: unknown): RewriteTemplate | null {
  const t = value as Partial<RewriteTemplate> | null;
  if (!t || typeof t !== "object" || !isRewriteTemplateId(t.id) || typeof t.builtIn !== "boolean" || !REWRITE_TEMPLATE_KINDS.includes(t.kind as RewriteTemplateKind)) return null;
  if (typeof t.name !== "string" || !t.name.trim() || typeof t.prompt !== "string") return null;
  const route = routeView(t.route);
  if (!route) return null;
  const out: RewriteTemplate = { id: t.id, builtIn: t.builtIn, kind: t.kind as RewriteTemplateKind, name: t.name, prompt: t.prompt, route };
  // r298: null = follows the global order; a malformed one is left out (shown as its own route, as on older hosts).
  if (t.routeOverride === null) out.routeOverride = null;
  else if (t.routeOverride !== undefined) { const own = routeView(t.routeOverride); if (own) out.routeOverride = own; }
  return out;
}

/** GET /v2/text-rewrite/templates: built-ins first (enhance, correction), then the owner's in host order. */
export function parseRewriteTemplateList(value: unknown): RewriteTemplate[] {
  const v = value as { contractVersion?: unknown; templates?: unknown } | null;
  if (!v || typeof v !== "object" || v.contractVersion !== 2 || !Array.isArray(v.templates)) throw new Error("invalid template list");
  const list = v.templates.map(parseRewriteTemplate).filter((t): t is RewriteTemplate => !!t);
  const rank = (t: RewriteTemplate) => (t.builtIn ? Math.max(0, (BUILTIN_TEMPLATES as readonly string[]).indexOf(t.id)) : BUILTIN_TEMPLATES.length);
  return list.map((t, i) => [t, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([t]) => t);
}

export function parseRewriteTemplateReply(value: unknown): RewriteTemplate {
  const v = value as { contractVersion?: unknown; template?: unknown } | null;
  const t = v && typeof v === "object" && v.contractVersion === 2 ? parseRewriteTemplate(v.template) : null;
  if (!t) throw new Error("invalid template reply");
  return t;
}

function correction(value: unknown, original: string): RewriteCorrection | null {
  const c = value as Partial<RewriteCorrection> | null;
  if (!c || typeof c !== "object" || !Number.isInteger(c.start) || !Number.isInteger(c.end)) return null;
  const start = c.start as number, end = c.end as number;
  if (start < 0 || end < start || end > original.length || typeof c.original !== "string" || original.slice(start, end) !== c.original) return null;
  if (typeof c.replacement !== "string" || typeof c.explanation !== "string" || typeof c.language !== "string") return null;
  const category = (CORRECTION_CATEGORIES as readonly string[]).includes(c.category as string) ? c.category as CorrectionCategory : "other";
  const alternatives = Array.isArray(c.alternatives)
    ? c.alternatives.flatMap((a): RewriteAlternative[] => {
      const x = a as { replacement?: unknown; when?: unknown; span?: unknown } | null;
      if (!x || typeof x.replacement !== "string" || typeof x.when !== "string" || !x.when.trim()) return [];
      if (x.span === undefined || x.span === null) return [{ replacement: x.replacement, when: x.when }];
      // A wider span must be exact and contain the change; one that is not is dropped (the others stay).
      const s = x.span as Partial<RewriteSpan>;
      if (typeof s !== "object" || !Number.isInteger(s.start) || !Number.isInteger(s.end)) return [];
      const from = s.start as number, to = s.end as number;
      if (from < 0 || from > start || to < end || to > original.length || typeof s.original !== "string" || original.slice(from, to) !== s.original) return [];
      return from === start && to === end ? [{ replacement: x.replacement, when: x.when }] : [{ replacement: x.replacement, when: x.when, span: { start: from, end: to, original: s.original } }];
    }).slice(0, 4)
    : [];
  return { start, end, original: c.original, replacement: c.replacement, category, explanation: c.explanation, language: c.language, alternatives };
}

/**
 * A 200 structured reply; null when it is not one. Corrections are kept only when they are exact spans of `original`,
 * in order and not overlapping (cutex checks the same); any one off and the list is dropped (the rewrite still shows).
 */
export function parseStructuredRewriteReply(value: unknown, original: string): Extract<StructuredRewriteResult, { ok: true }> | null {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== "object" || v.contractVersion !== 2 || typeof v.text !== "string" || !v.text) return null;
  const u = v.used as Record<string, unknown> | null;
  if (!u || typeof u !== "object" || typeof u.profileId !== "string" || !u.profileId || typeof u.provider !== "string" || typeof u.requestedModel !== "string") return null;
  if (u.model !== null && typeof u.model !== "string") return null;
  const suggestions: RewriteSuggestion[] = [];
  const ids = new Set<string>();
  for (const s of Array.isArray(v.suggestions) ? v.suggestions.slice(0, TEXT_REWRITE_MAX_SUGGESTIONS) : []) {
    const x = s as Partial<RewriteSuggestion> | null;
    if (!x || typeof x.id !== "string" || !ID.test(x.id) || ids.has(x.id) || typeof x.text !== "string" || !x.text.trim()) continue;
    ids.add(x.id);
    suggestions.push({ id: x.id, text: x.text, needsInput: x.needsInput === true });
  }
  let corrections: RewriteCorrection[] = [];
  if (Array.isArray(v.corrections)) {
    const list = v.corrections.slice(0, TEXT_REWRITE_MAX_CORRECTIONS).map((c) => correction(c, original));
    const ordered = list.every((c, i) => c && (i === 0 || list[i - 1]!.end <= c.start));
    corrections = ordered ? (list as RewriteCorrection[]) : [];
  }
  const dropped = v.droppedCorrections;
  const protection = v.protection === undefined ? null : protectionOf(v.protection);
  return {
    ok: true,
    text: v.text,
    suggestions,
    corrections,
    used: { profileId: u.profileId, provider: u.provider, model: (u.model as string | null) ?? null, requestedModel: u.requestedModel, fallbackUsed: u.fallbackUsed === true },
    ...(Number.isInteger(dropped) && (dropped as number) > 0 ? { droppedCorrections: Math.min(dropped as number, 999) } : {}),
    ...(protection ? { protection } : {}),
  };
}

/** An owner template's copy of `from` (a built-in or another template): same kind, prompt and route (r298: following the global order when `from` does). */
export function copyOfTemplate(from: RewriteTemplate, newName: string): RewriteTemplateCreate {
  return { kind: from.kind, name: newName.slice(0, REWRITE_TEMPLATE_NAME_MAX), prompt: from.prompt, route: from.routeOverride === null ? null : structuredClone(from.route) };
}
