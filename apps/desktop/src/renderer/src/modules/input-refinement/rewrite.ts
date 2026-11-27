// 输入优化 (module input-refinement; 提示词增强 owner 2026-11-24, a module of its own 2026-11-26): the input box's
// action asks cutex to rewrite the selection, or the whole draft, with a template (v1: prompt-enhance only,
// shared/textRewrite.ts; v2: the host's templates, shared/textRewriteV2.ts), shows original and rewrite side by side,
// and changes the draft only when the owner adopts it (Enter), as one undo step. This file holds the pure parts and
// the prefs (this desktop: the button, the v1 routing per host — Profile IDs belong to a host — and the last
// template per host); the request lives in ./useRewrite.ts. Storage key unchanged (`cutex.promptEnhance`).
import { useSyncExternalStore } from "react";
import { TEXT_REWRITE_MAX_PROFILES, type TextRewriteRoute } from "../../../../shared/textRewrite";
import type { RewriteCandidate, RewriteCorrection, RewriteSpan, RewriteTemplateRoute } from "../../../../shared/textRewriteV2";
import type { ComposerKey } from "../slots";

// ── Prefs ───────────────────────────────────────────────────────────────────────────────────────

export type PromptEnhanceMode = "agent" | "profile";
export interface PromptEnhanceHostRoute {
  /** agent = the open agent's own Profile (cutex resolves it) then the backups; profile = a fixed list in order. */
  mode: PromptEnhanceMode;
  /** Backup ordinary Profiles (hosts before feature-profiles; kept, no longer offered). */
  fallback: string[];
  /** The ordinary fixed list (hosts before feature-profiles; kept, no longer offered). */
  profiles: string[];
  /** 功能 Profile backups after the agent's own (agent mode, hosts with feature-profiles), at most three. */
  featureFallback: string[];
  /** The 功能 Profile list (profile mode, hosts with feature-profiles), one to four. */
  featureProfiles: string[];
}
export interface PromptEnhancePrefs {
  /** The composer button and shortcut; on by default where the host offers it. */
  enabled: boolean;
  hosts: Record<string, PromptEnhanceHostRoute>;
  /** The template the wand button / shortcut uses, per host (the last one picked; hosts with text-rewrite-v2). */
  lastTemplate: Record<string, string>;
  /**
   * Hosts whose text-rewrite-v2 built-in 提示词增强 already got this desktop's v1 route (Director 2026-11-26: migrate
   * once per host; never overwrite a route the owner set on the host). The v1 route itself stays for v1 hosts.
   */
  migrated: Record<string, true>;
}

const STORAGE_KEY = "cutex.promptEnhance";
export const DEFAULT_HOST_ROUTE: PromptEnhanceHostRoute = { mode: "agent", fallback: [], profiles: [], featureFallback: [], featureProfiles: [] };
const DEFAULTS: PromptEnhancePrefs = { enabled: true, hosts: {}, lastTemplate: {}, migrated: {} };

const ids = (value: unknown, max: number): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((x): x is string => typeof x === "string" && /^[A-Za-z0-9._:@-]{1,200}$/.test(x)))].slice(0, max) : [];

/** Stored prefs, malformed parts dropped. */
export function parsePromptEnhancePrefs(raw: unknown): PromptEnhancePrefs {
  const v = raw as { v?: unknown; enabled?: unknown; hosts?: unknown } | null;
  if (!v || typeof v !== "object" || v.v !== 1) return { ...DEFAULTS, hosts: {}, lastTemplate: {}, migrated: {} };
  const hosts: Record<string, PromptEnhanceHostRoute> = {};
  if (v.hosts && typeof v.hosts === "object") {
    for (const [hostId, r] of Object.entries(v.hosts as Record<string, unknown>)) {
      const x = r as Partial<Record<keyof PromptEnhanceHostRoute, unknown>> | null;
      if (!x || typeof x !== "object") continue;
      hosts[hostId] = {
        mode: x.mode === "profile" ? "profile" : "agent",
        fallback: ids(x.fallback, TEXT_REWRITE_MAX_PROFILES - 1),
        profiles: ids(x.profiles, TEXT_REWRITE_MAX_PROFILES),
        featureFallback: ids(x.featureFallback, TEXT_REWRITE_MAX_PROFILES - 1),
        featureProfiles: ids(x.featureProfiles, TEXT_REWRITE_MAX_PROFILES),
      };
    }
  }
  const lastTemplate: Record<string, string> = {};
  const last = (v as { lastTemplate?: unknown }).lastTemplate;
  if (last && typeof last === "object") for (const [hostId, id] of Object.entries(last as Record<string, unknown>)) if (typeof id === "string" && /^[A-Za-z0-9._:@-]{1,200}$/.test(id)) lastTemplate[hostId] = id;
  const migrated: Record<string, true> = {};
  const done = (v as { migrated?: unknown }).migrated;
  if (done && typeof done === "object") for (const [hostId, x] of Object.entries(done as Record<string, unknown>)) if (x === true) migrated[hostId] = true;
  return { enabled: v.enabled !== false, hosts, lastTemplate, migrated };
}

let prefs: PromptEnhancePrefs = load();
const listeners = new Set<() => void>();

function load(): PromptEnhancePrefs {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
    return parsePromptEnhancePrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULTS, hosts: {}, lastTemplate: {}, migrated: {} };
  }
}

function save(next: PromptEnhancePrefs): void {
  prefs = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, ...prefs }));
  } catch {
    // private mode / quota: holds for this window
  }
  for (const l of listeners) l();
}

export function promptEnhancePrefs(): PromptEnhancePrefs {
  return prefs;
}

export function hostRoute(hostId: string, from: PromptEnhancePrefs = prefs): PromptEnhanceHostRoute {
  return from.hosts[hostId] ?? DEFAULT_HOST_ROUTE;
}

export function setPromptEnhanceEnabled(enabled: boolean): void {
  save({ ...prefs, enabled });
}

export function setHostRoute(hostId: string, patch: Partial<PromptEnhanceHostRoute>): void {
  const cur = hostRoute(hostId);
  const next: PromptEnhanceHostRoute = {
    mode: patch.mode ?? cur.mode,
    fallback: ids(patch.fallback ?? cur.fallback, TEXT_REWRITE_MAX_PROFILES - 1),
    profiles: ids(patch.profiles ?? cur.profiles, TEXT_REWRITE_MAX_PROFILES),
    featureFallback: ids(patch.featureFallback ?? cur.featureFallback, TEXT_REWRITE_MAX_PROFILES - 1),
    featureProfiles: ids(patch.featureProfiles ?? cur.featureProfiles, TEXT_REWRITE_MAX_PROFILES),
  };
  save({ ...prefs, hosts: { ...prefs.hosts, [hostId]: next } });
}

export function setLastTemplate(hostId: string, templateId: string): void {
  if (prefs.lastTemplate[hostId] === templateId) return;
  save({ ...prefs, lastTemplate: { ...prefs.lastTemplate, [hostId]: templateId } });
}

/** The v1 route of this host was moved to (or deliberately left out of) its v2 built-in; never asked again. */
export function setRouteMigrated(hostId: string): void {
  if (prefs.migrated[hostId]) return;
  save({ ...prefs, migrated: { ...prefs.migrated, [hostId]: true } });
}

/**
 * This desktop's v1 route as a text-rewrite-v2 template route, or null when there is nothing to move (the default:
 * follow the agent with no backups, or a fixed list left empty). The set the host used under v1 decides: 功能
 * Profiles where the host has feature-profiles, ordinary Profiles otherwise (rewriteRoute above). v1 had no model
 * choice, so candidates carry none (each Profile's rewrite default).
 */
export function v2RouteFromLocal(route: PromptEnhanceHostRoute, featureProfiles: boolean): RewriteTemplateRoute | null {
  const kind: RewriteCandidate["kind"] = featureProfiles ? "featureProfile" : "profile";
  const as = (ids: string[]): RewriteCandidate[] => ids.map((profileId) => ({ kind, profileId }));
  if (route.mode === "profile") {
    const ids = (featureProfiles ? route.featureProfiles : route.profiles).slice(0, TEXT_REWRITE_MAX_PROFILES);
    return ids.length ? { mode: "profiles", candidates: as(ids) } : null;
  }
  const ids = (featureProfiles ? route.featureFallback : route.fallback).slice(0, TEXT_REWRITE_MAX_PROFILES - 1);
  return ids.length ? { mode: "agent", model: null, fallback: as(ids) } : null;
}

export function subscribePromptEnhancePrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function usePromptEnhancePrefs(): PromptEnhancePrefs {
  return useSyncExternalStore(subscribePromptEnhancePrefs, promptEnhancePrefs, promptEnhancePrefs);
}

/** Tests: forget storage and edits. */
export function resetPromptEnhancePrefsForTests(next?: PromptEnhancePrefs): void {
  prefs = next ?? { ...DEFAULTS, hosts: {}, lastTemplate: {}, migrated: {} };
  for (const l of listeners) l();
}

/**
 * The route cutex gets (feature-profiles-desktop.md); null = nothing to rewrite with (the composer says so).
 * With 功能 Profiles (`featureProfiles`: the host offers feature-profiles): 跟随{{agent}} = the agent's own Profile, then
 * the chosen 功能 Profiles in order (cutex also falls back to them when the agent's Profile can't be resolved); a
 * draft with no agent yet uses those 功能 Profiles alone. The fixed list = 功能 Profiles only.
 * Without (an older cutex, or after a rollback): exactly as before — the agent's own Profile then the ordinary backup
 * Profiles, or the fixed ordinary-Profile list. The two sets of choices are saved apart; each host uses its own set.
 */
export function rewriteRoute(route: PromptEnhanceHostRoute, sessionId: string | null, featureProfiles: boolean): TextRewriteRoute | null {
  if (!featureProfiles) {
    // Older cutex (no feature-profiles): today's ordinary-Profile backups / fixed list, unchanged.
    if (route.mode === "profile" || !sessionId) {
      const list = route.mode === "profile" ? route.profiles : route.fallback;
      return list.length ? { mode: "profile", profileIds: list.slice(0, TEXT_REWRITE_MAX_PROFILES) } : null;
    }
    return route.fallback.length
      ? { mode: "agent", sessionId, fallbackProfileIds: route.fallback.slice(0, TEXT_REWRITE_MAX_PROFILES - 1) }
      : { mode: "agent", sessionId };
  }
  const fallback = route.featureFallback.slice(0, TEXT_REWRITE_MAX_PROFILES - 1);
  if (route.mode === "profile" || !sessionId) {
    const list = route.mode === "profile" ? route.featureProfiles : fallback;
    return list.length ? { mode: "featureProfiles", featureProfileIds: list.slice(0, TEXT_REWRITE_MAX_PROFILES) } : null;
  }
  return fallback.length ? { mode: "agent", sessionId, fallbackFeatureProfileIds: fallback } : { mode: "agent", sessionId };
}

// ── Keys (while the panel or the template menu is open) ──────────────────────────────────────────

/**
 * What a key means while the panel is open (the input box asks after its own popups; composer.action §31):
 * `adopt` (Enter with a version shown), `cancel` (Esc: the request in flight, else the panel), `hold` (swallowed),
 * or null (the input box's own). No send / steer / queue / interrupt-and-send key reaches the input box meanwhile:
 * Enter with any modifier but Shift alone, and Tab (插话优先's queue key). Shift+Enter still adds a line. IME
 * composition never reaches here (the host skips it).
 */
export function panelKey(e: Pick<ComposerKey, "key" | "ctrl" | "meta" | "alt" | "shift">, phase: "idle" | "running" | "done" | "failed", adoptable: boolean): "adopt" | "cancel" | "hold" | null {
  if (phase === "idle") return null;
  const mods = e.ctrl || e.meta || e.alt;
  if (e.key === "Escape") return mods || e.shift ? "hold" : "cancel";
  if (e.key === "Enter") {
    if (e.shift && !mods) return null;
    return adoptable && !mods && !e.shift ? "adopt" : "hold";
  }
  if (e.key === "Tab" && !mods && !e.shift) return "hold";
  return null;
}

// ── Target and adoption ─────────────────────────────────────────────────────────────────────────

export interface EnhanceTarget {
  start: number;
  end: number;
  /** The text sent (the selection, or the whole draft). */
  text: string;
  whole: boolean;
}

/**
 * What a rewrite works on. Any non-empty selection is the target exactly as selected — even one covering the whole
 * draft (`whole` false: text typed after it later never joins a restart); "blankSelection" when it holds only
 * whitespace (never widened to the draft). Nothing selected: the whole draft; null when the draft is blank.
 */
export function enhanceTarget(draft: string, selStart: number | null | undefined, selEnd: number | null | undefined): EnhanceTarget | "blankSelection" | null {
  const a = Math.max(0, Math.min(selStart ?? 0, selEnd ?? 0, draft.length));
  const b = Math.max(0, Math.min(Math.max(selStart ?? 0, selEnd ?? 0), draft.length));
  if (b > a) return draft.slice(a, b).trim() ? { start: a, end: b, text: draft.slice(a, b), whole: false } : "blankSelection";
  if (!draft.trim()) return null;
  return { start: 0, end: draft.length, text: draft, whole: true };
}

/** 直接加上: the checked suggestions appended to a version as a list under `label` (no model call). */
export function appendSuggestions(text: string, picks: readonly { text: string; answer?: string }[], label: string): string {
  const lines = picks.map((p) => {
    const answer = p.answer?.trim();
    return answer ? `- ${p.text.trim()}：${answer}` : `- ${p.text.trim()}`;
  });
  if (!lines.length) return text;
  return [text.replace(/\s+$/, ""), "", label, ...lines].join("\n");
}

/** 「取决于你的意思」 picks: change index → alternative index (a missing index = the suggested replacement). */
export type CorrectionChoices = Readonly<Record<number, number>>;

/** One replacement a correction version makes: change `index`'s own span, or the wider span of its picked alternative. */
export interface CorrectionEdit extends RewriteSpan { index: number; replacement: string; wide: boolean }

const overlaps = (a: RewriteSpan, b: RewriteSpan) => (a.start === a.end ? b.start < a.start && a.start < b.end : b.start === b.end ? a.start < b.start && b.start < a.end : a.start < b.end && b.start < a.end);

/**
 * The replacements of a correction version with the owner's picks, in text order. A picked wider alternative replaces
 * its whole span; the changes it overlaps are left out (`covered`: change index → the change whose pick covers it).
 * Two wider picks that overlap: the earlier change's wins (choose() never leaves that state).
 */
export function correctionEdits(corrections: readonly RewriteCorrection[], choices: CorrectionChoices): { edits: CorrectionEdit[]; covered: Record<number, number> } {
  const wide: CorrectionEdit[] = [];
  corrections.forEach((c, index) => {
    const a = choices[index] === undefined ? undefined : c.alternatives[choices[index]!];
    if (a?.span && !wide.some((w) => overlaps(w, a.span!))) wide.push({ ...a.span, index, replacement: a.replacement, wide: true });
  });
  const edits = [...wide];
  const covered: Record<number, number> = {};
  corrections.forEach((c, index) => {
    if (wide.some((w) => w.index === index)) return;
    const over = wide.find((w) => overlaps(w, c));
    if (over) { covered[index] = over.index; return; }
    const a = choices[index] === undefined ? undefined : c.alternatives[choices[index]!];
    edits.push({ start: c.start, end: c.end, original: c.original, index, replacement: a && !a.span ? a.replacement : c.replacement, wide: false });
  });
  return { edits: edits.sort((x, y) => x.start - y.start || x.end - y.end), covered };
}

/** The picks after choosing alternative `alt` (null = as suggested) of change `index`: a wider pick drops overlapping wider picks. */
export function chooseCorrection(corrections: readonly RewriteCorrection[], choices: CorrectionChoices, index: number, alt: number | null): Record<number, number> {
  const next: Record<number, number> = { ...choices };
  const c = corrections[index];
  if (!c) return next;
  if (alt === null || !c.alternatives[alt]) { delete next[index]; return next; }
  next[index] = alt;
  const span = c.alternatives[alt]!.span;
  if (span) {
    for (const [k, j] of Object.entries(next)) {
      const other = corrections[+k]?.alternatives[j]?.span;
      if (+k !== index && other && overlaps(other, span)) delete next[+k];
    }
  }
  return next;
}

/** A correction template's draft: the original with each change applied as the owner picked (correctionEdits). */
export function applyCorrections(original: string, corrections: readonly RewriteCorrection[], choices: CorrectionChoices): string {
  let out = "";
  let at = 0;
  for (const e of correctionEdits(corrections, choices).edits) {
    out += original.slice(at, e.start) + e.replacement;
    at = e.end;
  }
  return out + original.slice(at);
}

/** The draft with the rewrite in place of the target, and the caret after it; null when the draft changed there since. */
export function adoptRewrite(draft: string, target: EnhanceTarget, rewrite: string): { text: string; caret: number } | null {
  if (draft.slice(target.start, target.end) !== target.text) return null;
  if (target.whole && draft.length !== target.end) return null;
  return { text: draft.slice(0, target.start) + rewrite + draft.slice(target.end), caret: target.start + rewrite.length };
}

// ── Diff (for the compare view) ─────────────────────────────────────────────────────────────────

export interface DiffPart { kind: "same" | "removed" | "added"; text: string }

/** Words, runs of spaces, single CJK characters and punctuation: small enough to show what changed. */
export function diffTokens(text: string): string[] {
  return text.match(/\s+|[A-Za-z0-9_'’-]+|[㐀-鿿豈-﫿]|[\s\S]/gu) ?? [];
}

/** Above this many token pairs the diff gives up (both sides shown whole, no highlights). */
const DIFF_BUDGET = 2_000_000;

/** A token diff of two texts (LCS after trimming the shared head and tail); null when too large. */
export function diffTexts(a: string, b: string): DiffPart[] | null {
  const x = diffTokens(a), y = diffTokens(b);
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
  const xs = x.slice(head, x.length - tail), ys = y.slice(head, y.length - tail);
  if (xs.length * ys.length > DIFF_BUDGET) return null;
  const n = xs.length, m = ys.length;
  // lcs[i][j] = LCS of xs[i..] and ys[j..], one row array per i.
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = xs[i] === ys[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else if (text) out.push({ kind, text });
  };
  push("same", x.slice(0, head).join(""));
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (xs[i] === ys[j]) { push("same", xs[i]!); i++; j++; }
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) push("removed", xs[i++]!);
    else push("added", ys[j++]!);
  }
  while (i < n) push("removed", xs[i++]!);
  while (j < m) push("added", ys[j++]!);
  push("same", x.slice(x.length - tail).join(""));
  return out;
}
