// 提示词增强 (owner 2026-11-24, experimental): the composer asks cutex to rewrite the selection, or the whole draft,
// with the prompt-enhance template (shared/textRewrite.ts), shows original and rewrite side by side, and changes the
// draft only when the owner adopts it (Enter), as one undo step. This file holds the pure parts and the routing
// prefs (this desktop, per host: Profile IDs belong to a host); the request lives in lib/usePromptEnhance.ts.
import { useSyncExternalStore } from "react";
import { TEXT_REWRITE_MAX_PROFILES, type TextRewriteRoute } from "../../../shared/textRewrite";
import { isImeComposing } from "./ime";
import { matchesCommand, type KeyLike } from "./keybindings";

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
}

const STORAGE_KEY = "cutex.promptEnhance";
export const DEFAULT_HOST_ROUTE: PromptEnhanceHostRoute = { mode: "agent", fallback: [], profiles: [], featureFallback: [], featureProfiles: [] };
const DEFAULTS: PromptEnhancePrefs = { enabled: true, hosts: {} };

const ids = (value: unknown, max: number): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((x): x is string => typeof x === "string" && /^[A-Za-z0-9._:@-]{1,200}$/.test(x)))].slice(0, max) : [];

/** Stored prefs, malformed parts dropped. */
export function parsePromptEnhancePrefs(raw: unknown): PromptEnhancePrefs {
  const v = raw as { v?: unknown; enabled?: unknown; hosts?: unknown } | null;
  if (!v || typeof v !== "object" || v.v !== 1) return { ...DEFAULTS, hosts: {} };
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
  return { enabled: v.enabled !== false, hosts };
}

let prefs: PromptEnhancePrefs = load();
const listeners = new Set<() => void>();

function load(): PromptEnhancePrefs {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
    return parsePromptEnhancePrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULTS, hosts: {} };
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

export function subscribePromptEnhancePrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function usePromptEnhancePrefs(): PromptEnhancePrefs {
  return useSyncExternalStore(subscribePromptEnhancePrefs, promptEnhancePrefs, promptEnhancePrefs);
}

/** Tests: forget storage and edits. */
export function resetPromptEnhancePrefsForTests(next?: PromptEnhancePrefs): void {
  prefs = next ?? { ...DEFAULTS, hosts: {} };
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

// ── Keys (in the composer) ──────────────────────────────────────────────────────────────────────

/**
 * What a key press in the composer means for 提示词增强: `start` (the rebindable command), `adopt` (Enter on an
 * answer), `cancel` (Esc while anything is shown: drops the request too), `hold` (swallowed), or null (the composer's
 * own). While the panel is open (running, answer or failure) no send / steer / queue / interrupt-and-send key reaches
 * the composer: Enter with any modifier but Shift alone, and Tab (插话优先's queue key). Shift+Enter still adds a line.
 * Esc closes the panel first; after that keys behave as usual. IME composition is never ours. Popups (@ / palette)
 * are handled first.
 */
export function promptEnhanceKey(e: KeyLike, on: boolean, phase: "idle" | "running" | "done" | "failed"): "start" | "adopt" | "cancel" | "hold" | null {
  if (!on || isImeComposing(e)) return null;
  if (matchesCommand("promptEnhance", e)) return "start";
  if (phase === "idle") return null;
  const mods = e.ctrlKey || e.metaKey || e.altKey;
  if (e.key === "Escape") return mods || e.shiftKey ? "hold" : "cancel";
  if (e.key === "Enter") {
    if (e.shiftKey && !mods) return null;
    return phase === "done" && !mods && !e.shiftKey ? "adopt" : "hold";
  }
  if (e.key === "Tab" && !mods && !e.shiftKey) return "hold";
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

/** The selection when it holds text, else the whole draft; null when there is nothing to rewrite. */
export function enhanceTarget(draft: string, selStart: number | null | undefined, selEnd: number | null | undefined): EnhanceTarget | null {
  const a = Math.max(0, Math.min(selStart ?? 0, selEnd ?? 0, draft.length));
  const b = Math.max(0, Math.min(Math.max(selStart ?? 0, selEnd ?? 0), draft.length));
  if (b > a && draft.slice(a, b).trim()) return { start: a, end: b, text: draft.slice(a, b), whole: a === 0 && b === draft.length };
  if (!draft.trim()) return null;
  return { start: 0, end: draft.length, text: draft, whole: true };
}

/** The draft with the rewrite in place of the target, and the caret after it; null when the draft changed there since. */
export function adoptRewrite(draft: string, target: EnhanceTarget, rewrite: string): { text: string; caret: number } | null {
  if (draft.slice(target.start, target.end) !== target.text) return null;
  if (target.whole && draft.length !== target.end) return null;
  return { text: draft.slice(0, target.start) + rewrite + draft.slice(target.end), caret: target.start + rewrite.length };
}

/**
 * Replace [start, end) of a textarea through the browser's own editing (`insertText`), so the change is one entry of
 * the textarea's undo history (Ctrl+Z restores the draft) and React hears it as typed input. False when the browser
 * did not do it (no execCommand, or the result is not `expected`): the caller sets the draft itself.
 */
export function insertUndoable(el: HTMLTextAreaElement, start: number, end: number, text: string, expected: string): boolean {
  try {
    el.focus();
    el.setSelectionRange(start, end);
    const done = typeof el.ownerDocument.execCommand === "function" && el.ownerDocument.execCommand("insertText", false, text);
    return done && el.value === expected;
  } catch {
    return false;
  }
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
