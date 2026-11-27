// The host's rewrite templates (cutex text-rewrite-v2, shared/textRewriteV2.ts) in the renderer: one list per host,
// read on first use, updated in place after a create / edit / delete. Hosts without text-rewrite-v2 have one
// template only: the v1 prompt-enhance call (V1_TEMPLATE), routed by this desktop's prefs (./rewrite.ts).
import { useEffect, useSyncExternalStore } from "react";
import { BUILTIN_CORRECTION_TEMPLATE, BUILTIN_ENHANCE_TEMPLATE, BUILTIN_GRAMMAR_TEMPLATE, type RewriteCandidate, type RewriteTemplate, type RewriteTemplateRoute } from "../../../../shared/textRewriteV2";
import { useI18n, type MessageKey } from "../../i18n";
import { useFeatureProfiles } from "../../lib/featureProfiles";
import { apiFor } from "../../bridge";
import type { TemplateRef } from "./useRewrite";
import { hostRoute, promptEnhancePrefs, setRouteMigrated, v2RouteFromLocal } from "./rewrite";
import { INPUT_REFINEMENT_PAGE, INPUT_REFINEMENT_TEMPLATE_SUB } from "../../lib/inputRefinementNav";

export interface TemplateList {
  /** null while the first read runs (or after it failed). */
  list: RewriteTemplate[] | null;
  error: string | null;
}

/** The only template of a v1 host. */
export const V1_TEMPLATE: TemplateRef = { id: BUILTIN_ENHANCE_TEMPLATE, kind: "enhance", v2: false };

const EMPTY: TemplateList = { list: null, error: null };
const lists = new Map<string, TemplateList>();
const reads = new Map<string, number>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (hostId: string, next: TemplateList) => { lists.set(hostId, next); emit(); };
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A built-in's route as cutex ships it: follow the agent, no backups (text-rewrite-v2.md). */
const isDefaultRoute = (route: RewriteTemplate["route"]) => route.mode === "agent" && route.fallback.length === 0;
const migrating = new Set<string>();

/**
 * Once per host (Director 2026-11-26): the owner's v1 routing saved on this desktop (cutex.promptEnhance) becomes the
 * route of the host's built-in 提示词增强 — only while that template still has cutex's default route (a route the owner
 * set on the host is never overwritten). Done = recorded per host, also when there was nothing to move; a failed PATCH
 * is tried again on the next read. The local value stays for v1 hosts.
 */
async function migrateLocalRoute(hostId: string, list: RewriteTemplate[], featureProfiles: boolean): Promise<void> {
  if (promptEnhancePrefs().migrated[hostId] || migrating.has(hostId)) return;
  const builtIn = list.find((t) => t.builtIn && t.id === BUILTIN_ENHANCE_TEMPLATE);
  if (!builtIn) return; // not listed (yet): ask again next time
  const route = v2RouteFromLocal(hostRoute(hostId), featureProfiles);
  if (!route || !isDefaultRoute(builtIn.route)) return setRouteMigrated(hostId);
  migrating.add(hostId);
  try {
    putTemplate(hostId, await apiFor(hostId).patchTextRewriteTemplate(builtIn.id, { route }));
    setRouteMigrated(hostId);
  } catch {
    // Offline, refused (a Profile gone): the local value stays; the next read tries again.
  } finally {
    migrating.delete(hostId);
  }
}

export async function loadTemplates(hostId: string, featureProfiles = false): Promise<void> {
  const mine = (reads.get(hostId) ?? 0) + 1;
  reads.set(hostId, mine);
  try {
    const list = await apiFor(hostId).textRewriteTemplates();
    if (reads.get(hostId) === mine) set(hostId, { list, error: null });
    await migrateLocalRoute(hostId, list, featureProfiles);
  } catch (e) {
    if (reads.get(hostId) === mine) set(hostId, { list: lists.get(hostId)?.list ?? null, error: errorText(e) });
  }
}

/** A template the host returned after a create / edit (appended when new). */
export function putTemplate(hostId: string, template: RewriteTemplate): void {
  const cur = lists.get(hostId)?.list ?? [];
  reads.set(hostId, (reads.get(hostId) ?? 0) + 1);
  set(hostId, { list: cur.some((t) => t.id === template.id) ? cur.map((t) => (t.id === template.id ? template : t)) : [...cur, template], error: null });
}

export function dropTemplate(hostId: string, id: string): void {
  const cur = lists.get(hostId)?.list;
  if (!cur) return;
  reads.set(hostId, (reads.get(hostId) ?? 0) + 1);
  set(hostId, { list: cur.filter((t) => t.id !== id), error: null });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * The host's templates; `enabled` false (no text-rewrite-v2): nothing is read. `featureProfiles`: the host has
 * feature-profiles (which v1 route set the one-time migration moves).
 */
export function useTemplates(hostId: string, enabled: boolean, featureProfiles = false): TemplateList & { reload(): void } {
  const value = useSyncExternalStore(subscribe, () => (enabled ? (lists.get(hostId) ?? EMPTY) : EMPTY));
  useEffect(() => {
    if (enabled) void loadTemplates(hostId, featureProfiles);
  }, [hostId, enabled, featureProfiles]);
  return { ...value, reload: () => void loadTemplates(hostId, featureProfiles) };
}

// ── r298 (text-rewrite-global-route): the global Profile order, one per host ───────────────────────

export interface GlobalRoute { route: RewriteTemplateRoute | null; error: string | null }
const NO_GLOBAL: GlobalRoute = { route: null, error: null };
const globals = new Map<string, GlobalRoute>();

export async function loadGlobalRoute(hostId: string): Promise<void> {
  try {
    globals.set(hostId, { route: await apiFor(hostId).textRewriteRoute(), error: null });
  } catch (e) {
    globals.set(hostId, { route: globals.get(hostId)?.route ?? null, error: errorText(e) });
  }
  emit();
}

/** The host saved a new global order: templates that follow it now use it (their effective routes are re-read). */
export function putGlobalRoute(hostId: string, route: RewriteTemplateRoute): void {
  globals.set(hostId, { route, error: null });
  emit();
  if (lists.has(hostId)) void loadTemplates(hostId);
}

/** The host's global order; `enabled` false (no text-rewrite-global-route): nothing is read. */
export function useGlobalRoute(hostId: string, enabled: boolean): GlobalRoute {
  const value = useSyncExternalStore(subscribe, () => (enabled ? (globals.get(hostId) ?? NO_GLOBAL) : NO_GLOBAL));
  useEffect(() => {
    if (enabled && !globals.get(hostId)?.route) void loadGlobalRoute(hostId);
  }, [hostId, enabled]);
  return value;
}

/** r298: the template follows the global order (older hosts never say so). */
export const followsGlobal = (template: RewriteTemplate | null | undefined): boolean => template?.routeOverride === null;

/** A route in a line (功能 Profiles by name; ordinary ones by ID until read). */
export function useRouteText(hostId: string): (route: RewriteTemplateRoute) => string {
  const { t } = useI18n();
  const features = useFeatureProfiles(hostId).list;
  return (route) => {
    const name = (c: RewriteCandidate) => `${features?.find((f) => f.id === c.profileId)?.name ?? c.profileId}${c.model ? ` · ${c.model}` : ""}`;
    if (route.mode === "agent") {
      return route.fallback.length ? t("input-refinement.settings.summary.agentFallback", { names: route.fallback.map(name).join("、") }) : t("input-refinement.settings.summary.agent");
    }
    return route.candidates.map(name).join(" → ");
  };
}

/** Tests: forget every host's list. */
export function resetTemplatesForTests(): void {
  lists.clear();
  reads.clear();
  globals.clear();
  migrating.clear();
  emit();
}

/** Built-ins are named in the UI language by ID; the owner's by their own name. */
export function templateName(t: (key: MessageKey) => string, template: { id: string; builtIn?: boolean; name?: string }): string {
  if (template.builtIn !== false && template.id === BUILTIN_ENHANCE_TEMPLATE) return t("input-refinement.template.enhance");
  if (template.builtIn !== false && template.id === BUILTIN_CORRECTION_TEMPLATE) return t("input-refinement.template.correction");
  if (template.builtIn !== false && template.id === BUILTIN_GRAMMAR_TEMPLATE) return t("input-refinement.template.grammar");
  return template.name ?? template.id;
}

/** What a template does, in one line: 语法纠错 (r298 built-in) has its own; otherwise by kind. */
export function templateSummaryKey(template: { id: string; kind: string; builtIn?: boolean }): MessageKey {
  if (template.builtIn !== false && template.id === BUILTIN_GRAMMAR_TEMPLATE) return "input-refinement.settings.summary.grammar";
  return template.kind === "correction" ? "input-refinement.settings.summary.correction" : "input-refinement.settings.summary.enhance";
}

export const refOf = (template: RewriteTemplate): TemplateRef => ({ id: template.id, kind: template.kind, v2: true });

// ── The template sub-page (设置 › 会话 › 输入优化 › 模板): which one it shows ─────────────────────────

/** An existing template by ID, or a new one (blank, or a copy of another: not saved until 创建). */
export type TemplateEdit = { hostId: string; id: string } | { hostId: string; draft: import("../../../../shared/textRewriteV2").RewriteTemplateCreate; copiedFrom: string | null };

let editing: TemplateEdit | null = null;
const editListeners = new Set<() => void>();

export function setTemplateEdit(next: TemplateEdit | null): void {
  editing = next;
  editListeners.forEach((l) => l());
}

export function useTemplateEdit(): TemplateEdit | null {
  return useSyncExternalStore((l) => { editListeners.add(l); return () => void editListeners.delete(l); }, () => editing);
}

/** r298: the detail page's 全局顺序 section (settingsAnchorId). */
export const GLOBAL_ROUTE_SECTION = "input-refinement-global";

/** The detail page under 会话 (templates / which Profiles) and its template sub-page key (lib/inputRefinementNav). */
export const SETTINGS_PAGE = INPUT_REFINEMENT_PAGE;
export const TEMPLATE_SUB = INPUT_REFINEMENT_TEMPLATE_SUB;
