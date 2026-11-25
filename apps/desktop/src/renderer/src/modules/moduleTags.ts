// Settings → 模块 → 全部模块 (owner 2026-11-24): one tag system for every module row, the version shown the same way
// everywhere, and the list's search / filter / sort. Pure; the rows render in shell/ModulesPage.tsx, the tags (the
// settings ScopeChip: a click floats the explanation) in shell/ModulePacks.tsx ModuleTags.
//
// Order after the name, always: origin chip → version (muted text, never inside a chip) → trust → risk → state.
//   origin   核心 (required) · 内置 (ships with the app) · 已下载 (a signed pack in use) · 本地安装 (from a file, or a
//            developer folder) · 已安装 (a copy that failed its check: where it came from is not known) · 可下载 (index only)
//   version  the module's own pack version where it has one (a pack: downloaded / local / offered; a bundled module
//            with a pack.json, which can be updated on its own, e.g. Claude Science); otherwise the desktop app's
//            version (core and bundled modules ship with it). Hidden while the app version is unknown.
//   trust    未验证: anything not a verified signed pack (from a file, a developer folder, a copy that failed its check);
//            only 已下载 / 可下载 words say the publisher is verified.
//   risk     内部接口 (reads app internals, a local module in a dev build) · 实验接口 (module-api/experimental)
//   state    未使用 · 需更新应用 · 需更新模块 · 加载失败 · 已损坏 (an installed pack that is not in use, and why)
// The update itself stays a button (更新到 vX) on the right; core modules show a locked switch there.
import type { PackRow } from "./packs";
import { readsAppInternals } from "../../../shared/modulePacks";
import { usesExperimentalApi } from "./packHost";

export type ModuleOrigin = "core" | "bundled" | "downloaded" | "local" | "installed" | "available";
export type ModuleTagKind = "unverified" | "internal" | "experimental" | "notNewer" | "needsNewerApp" | "needsNewerModule" | "failed" | "broken";
export type TagTone = "plain" | "warn" | "danger";

export interface ModuleTag {
  kind: ModuleTagKind;
  tone: TagTone;
  /** For the popover text: the version / error it is about. */
  version?: string;
  error?: string;
}

export interface ModuleFacts {
  origin: ModuleOrigin;
  /** Shown as a muted "v…" after the origin chip; null = none. */
  version: string | null;
  /** Whose version it is: the module's own (a pack) or the app's. */
  versionOf: "module" | "app" | null;
  tags: ModuleTag[];
}

/** A module loaded from a developer folder (developer mode): its last good build's version and host imports. */
export interface DevModuleFacts {
  version: string | null;
  host: Readonly<Record<string, readonly string[]>>;
}

/**
 * Origin, version and tags of one row. `pack` null = a core module or no pack bridge; `appVersion` the desktop's;
 * `dev` the developer-folder build this row's module is running from, if any (it wins: that is the code running).
 */
export function moduleFacts(input: { required: boolean; pack: PackRow | null; appVersion: string | null; dev?: DevModuleFacts | null }): ModuleFacts {
  const { required, pack, appVersion, dev } = input;
  const app = (origin: ModuleOrigin): ModuleFacts => ({ origin, version: appVersion, versionOf: appVersion ? "app" : null, tags: [] });
  if (required) return app("core");
  if (dev) {
    const tags: ModuleTag[] = [{ kind: "unverified", tone: "warn" }];
    if (readsAppInternals(dev.host)) tags.push({ kind: "internal", tone: "warn" });
    if (usesExperimentalApi(dev.host)) tags.push({ kind: "experimental", tone: "warn" });
    return { origin: "local", version: dev.version, versionOf: dev.version ? "module" : null, tags };
  }
  if (!pack) return app("bundled");
  const tags: ModuleTag[] = [];
  const d = pack.decision;
  const installed = pack.installed;
  const localInUse = !!installed?.local && (!!pack.activeVersion || !d || d.use);
  let origin: ModuleOrigin;
  let version: string | null;
  let versionOf: ModuleFacts["versionOf"] = "module";
  if (localInUse) {
    origin = "local";
    version = installed!.version;
  } else if (pack.activeVersion) {
    origin = "downloaded";
    version = pack.activeVersion;
  } else if (pack.bundled) {
    origin = "bundled";
    version = pack.bundledVersion ?? appVersion;
    versionOf = pack.bundledVersion ? "module" : appVersion ? "app" : null;
  } else if (installed) {
    // A pack-only module whose installed copy is not in use (see the state tag).
    origin = installed.local ? "local" : "downloaded";
    version = installed.version;
  } else if (pack.broken) {
    // Failed its start-up check: signed or from a file, it can't be told now, so it is neither 已下载 nor verified.
    origin = "installed";
    version = pack.broken.version;
  } else {
    origin = "available";
    version = pack.available[0]?.version ?? null;
    if (!version) versionOf = null;
  }
  if (installed?.local || (!installed && pack.broken)) tags.push({ kind: "unverified", tone: "warn" });
  if (installed?.local && readsAppInternals(installed.host)) tags.push({ kind: "internal", tone: "warn" });
  if (installed && usesExperimentalApi(installed.host)) tags.push({ kind: "experimental", tone: "warn" });
  if (installed && d && !d.use && d.reason !== "notPackable") {
    const v = installed.version;
    if (d.reason === "notNewer") tags.push({ kind: "notNewer", tone: "plain", version: v });
    else if (d.reason === "needsNewerApp") tags.push({ kind: "needsNewerApp", tone: "warn", version: v });
    else if (d.reason === "needsNewerModule") tags.push({ kind: "needsNewerModule", tone: "warn", version: v });
    else if (d.reason === "failed") tags.push({ kind: "failed", tone: "danger", version: v, error: d.detail ?? "" });
  }
  if (pack.broken) tags.push({ kind: "broken", tone: "danger", version: pack.broken.version, error: pack.broken.error });
  return { origin, version, versionOf: version ? versionOf : null, tags };
}

// ── list toolbar ────────────────────────────────────────────────────────────────────────────────

export const MODULE_FILTERS = ["all", "enabled", "disabled", "core", "bundled", "installed", "update", "unverified"] as const;
export type ModuleFilter = (typeof MODULE_FILTERS)[number];
export const MODULE_SORTS = ["default", "name", "recent"] as const;
export type ModuleSort = (typeof MODULE_SORTS)[number];

export interface ModuleListItem {
  id: string;
  title: string;
  detail?: string;
  facts: ModuleFacts;
  enabled: boolean;
  hasUpdate: boolean;
  /** When this desktop first saw the installed version (ms); null = not installed. */
  installedAt: number | null;
}

export function matchesModule(item: ModuleListItem, query: string, filter: ModuleFilter): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (q && ![item.title, item.detail ?? "", item.id].some((s) => s.toLocaleLowerCase().includes(q))) return false;
  switch (filter) {
    case "all": return true;
    case "enabled": return item.enabled;
    case "disabled": return !item.enabled;
    case "core": return item.facts.origin === "core";
    case "bundled": return item.facts.origin === "bundled";
    case "installed": return item.facts.origin === "local" || item.facts.origin === "downloaded" || item.facts.origin === "installed";
    case "update": return item.hasUpdate;
    case "unverified": return item.facts.tags.some((t) => t.kind === "unverified");
  }
}

/** default: the given order (what you added first, then the app's); name: by title; recent: newest install first. */
export function sortModules<T extends ModuleListItem>(items: readonly T[], sort: ModuleSort, locale: string): T[] {
  const indexed = items.map((item, i) => ({ item, i }));
  if (sort === "name") indexed.sort((a, b) => a.item.title.localeCompare(b.item.title, locale) || a.i - b.i);
  else if (sort === "recent") indexed.sort((a, b) => (b.item.installedAt ?? -1) - (a.item.installedAt ?? -1) || a.i - b.i);
  return indexed.map((x) => x.item);
}

// ── when this desktop first saw an installed version (for 最近安装 / 更新) ───────────────────────────

const SEEN_KEY = "cutex.modules.seen";

/**
 * id → { version, at }: the installed version and when it first showed up here. Updated in place; returns the times.
 * `installed` null = the pack view has not loaded yet: the ledger is only read (never pruned or stamped from nothing).
 */
export function noteInstalled(installed: readonly { id: string; version: string }[] | null, now = Date.now(), storage: Pick<Storage, "getItem" | "setItem"> | null = typeof localStorage === "undefined" ? null : localStorage): Record<string, number> {
  let seen: Record<string, { version: string; at: number }> = {};
  try {
    const raw = storage?.getItem(SEEN_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (parsed && typeof parsed === "object") seen = parsed as typeof seen;
  } catch {
    seen = {};
  }
  if (!installed) return Object.fromEntries(Object.entries(seen).flatMap(([id, v]) => (v && Number.isFinite(v.at) ? [[id, v.at]] : [])));
  let changed = false;
  const next: typeof seen = {};
  for (const p of installed) {
    const prev = seen[p.id];
    if (prev && prev.version === p.version && Number.isFinite(prev.at)) next[p.id] = prev;
    else { next[p.id] = { version: p.version, at: now }; changed = true; }
  }
  if (changed || Object.keys(seen).length !== Object.keys(next).length) {
    try { storage?.setItem(SEEN_KEY, JSON.stringify(next)); } catch { /* holds for this view */ }
  }
  return Object.fromEntries(Object.entries(next).map(([id, v]) => [id, v.at]));
}
