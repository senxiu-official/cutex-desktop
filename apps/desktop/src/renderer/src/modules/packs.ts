// Signed module packs in the renderer (docs/desktop-modules.md §23.6): which installed pack takes effect,
// importing its entry from main's cutex-module:// scheme, and swapping it in through the module host's
// dynamic registration (§15: removeModule → addModules) with a fallback to the bundled copy. No second
// engine: a pack's definition is an ordinary ModuleDefinition in the same host.
import { useSyncExternalStore } from "react";
import { MODULE_API_VERSION, moduleApiSatisfies } from "@cutex-desktop/plugin-sdk";
import { comparePackVersions, isPackModuleId, type AvailablePackView, type InstalledPackView, type ModulePacksBridge, type ModulePacksView } from "../../../shared/modulePacks";
import { registerModuleMessages, unregisterModuleMessages } from "../i18n";
import { checkHostImports, installPackHost } from "./packHost";
import type { AppModule, AppModuleHost } from "./slots";

/** Why an installed pack is (not) used. */
export type PackDecision =
  | { use: true }
  | { use: false; reason: "notPackable" | "notNewer" | "needsNewerApp" | "needsNewerModule" | "failed"; detail?: string };

/**
 * Pure: whether `pack` replaces the bundled copy. `bundled`: undefined = no bundled copy (pack-only
 * module), null = bundled without pack.json (never overridden), else the bundled version.
 */
export function packDecision(pack: InstalledPackView, bundled: string | null | undefined, opts: { missingHost?: readonly string[]; failed?: string | null; appModuleApi?: string } = {}): PackDecision {
  if (bundled === null) return { use: false, reason: "notPackable" };
  if (pack.compat !== "ok" || !moduleApiSatisfies(pack.moduleApi, opts.appModuleApi ?? MODULE_API_VERSION)) {
    return { use: false, reason: pack.compat === "needsNewerModule" ? "needsNewerModule" : "needsNewerApp" };
  }
  if (opts.missingHost?.length) return { use: false, reason: "needsNewerApp", detail: opts.missingHost.join(", ") };
  if (bundled !== undefined && comparePackVersions(pack.version, bundled) <= 0) return { use: false, reason: "notNewer" };
  if (opts.failed) return { use: false, reason: "failed", detail: opts.failed };
  return { use: true };
}

/** Checks an imported entry against its index entry; returns the definition or throws with the reason. */
export function validatePackEntry(ns: unknown, pack: InstalledPackView): { module: AppModule; messages: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined } {
  if (!ns || typeof ns !== "object") throw new Error("the entry exports nothing");
  const e = ns as Record<string, unknown>;
  if (e.moduleApi !== pack.moduleApi) throw new Error(`the entry says moduleApi ${JSON.stringify(e.moduleApi)}, the signed index ${pack.moduleApi}`);
  const def = e.module as Partial<AppModule> | undefined;
  if (!def || typeof def !== "object") throw new Error("the entry exports no module definition");
  if (def.id !== pack.id || !isPackModuleId(def.id)) throw new Error(`the entry's module id ${JSON.stringify(def.id)} is not ${pack.id}`);
  if (def.required) throw new Error("a pack cannot be a required (core) module");
  if (typeof def.titleKey !== "string") throw new Error("the module has no titleKey");
  const messages = e.messages;
  if (messages !== undefined && (!messages || typeof messages !== "object" || Array.isArray(messages))) throw new Error("bad messages export");
  return { module: def as AppModule, messages: messages as Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined };
}

// ---- one Settings → 模块 row (pure) ----

export interface PackRow {
  id: string;
  /** The app has a bundled copy; `bundledVersion` null = bundled without pack.json (never overridden). */
  bundled: boolean;
  bundledVersion: string | null;
  installed: InstalledPackView | null;
  /** The pack version registered instead of the bundled copy, if any. */
  activeVersion: string | null;
  decision: (PackDecision & { version: string }) | null;
  broken: { version: string; error: string } | null;
  /** What to offer: the newest compatible version above what is used now. */
  offer: { kind: "download" | "update"; version: string } | null;
  /** Other compatible versions in the index (explicit choice; `older` = below what is used now). */
  others: { version: string; older: boolean }[];
  operation: ModulePacksView["operation"];
  error: ModulePacksView["lastError"];
  /** The index's entries for this id (newest first): titles for pack-only modules. */
  available: AvailablePackView[];
}

export function packRow(id: string, rt: PackRuntime, bundled: boolean, bundledVersion: string | null): PackRow {
  const view = rt.view;
  const installed = view?.installed.find((p) => p.id === id) ?? null;
  const broken = view?.broken.find((b) => b.id === id) ?? null;
  const available = (view?.index?.packs.filter((p) => p.id === id) ?? []).sort((a, b) => comparePackVersions(b.version, a.version));
  const usable = bundled && bundledVersion === null ? [] : available.filter((p) => p.compat === "ok");
  const baseline = installed?.version ?? (bundled ? bundledVersion : null);
  const best = usable[0];
  const offer = best && (baseline === null || comparePackVersions(best.version, baseline) > 0) ? { kind: installed || bundled ? ("update" as const) : ("download" as const), version: best.version } : null;
  const others = usable
    .filter((p) => p.version !== installed?.version && p.version !== offer?.version)
    .map((p) => ({ version: p.version, older: baseline !== null && comparePackVersions(p.version, baseline) < 0 }));
  return {
    id,
    bundled,
    bundledVersion,
    installed,
    activeVersion: rt.active[id] ?? null,
    decision: rt.decisions[id] ?? null,
    broken: broken ? { version: broken.version, error: broken.error } : null,
    offer,
    others,
    operation: view?.operation?.id === id ? view.operation : null,
    error: view?.lastError?.id === id ? view.lastError : null,
    available,
  };
}

// ---- runtime state (for Settings → 模块) ----

export interface PackRuntime {
  view: ModulePacksView | null;
  /** id → version of the pack currently registered instead of the bundled copy. */
  active: Readonly<Record<string, string>>;
  /** id → why the installed pack is not used (decided at the last sync). */
  decisions: Readonly<Record<string, PackDecision & { version: string }>>;
  /** Ids of the bundled modules (registry.ts) and their pack versions (null = not packable). */
  bundled: Readonly<Record<string, string | null>> | null;
}

let runtime: PackRuntime = { view: null, active: {}, decisions: {}, bundled: null };
const listeners = new Set<() => void>();
function publish(next: Partial<PackRuntime>): void {
  runtime = { ...runtime, ...next };
  for (const l of listeners) l();
}
export function packRuntime(): PackRuntime {
  return runtime;
}
export function usePackRuntime(): PackRuntime {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => runtime,
  );
}

export interface PackLoaderDeps {
  host: AppModuleHost;
  /** The bundled definitions (registry.ts), to restore on fallback / removal. */
  bundled: readonly AppModule[];
  /** id → bundled version (modules/packVersions.ts). */
  bundledVersions: Readonly<Record<string, string>>;
  bridge: ModulePacksBridge;
  /** Imports an entry URL (the app: a dynamic import of the cutex-module:// URL). */
  importEntry(url: string): Promise<unknown>;
  /** Adds a pack's stylesheets (the app: <link> elements; idempotent per URL). */
  addStyles?(urls: readonly string[]): void;
  log?(text: string): void;
}

/** The module packs controller: follows main's view and keeps the host's definitions in line with it. */
export function createPackLoader(deps: PackLoaderDeps) {
  const failed = new Map<string, { version: string; error: string }>(); // per run, per version
  const active = new Map<string, string>();
  let chain: Promise<void> = Promise.resolve();
  let lastView: ModulePacksView | null = null;

  const bundledDef = (id: string) => deps.bundled.find((m) => m.id === id);
  const bundledVersion = (id: string): string | null | undefined => (bundledDef(id) ? (deps.bundledVersions[id] ?? null) : undefined);

  async function restoreBundled(id: string): Promise<void> {
    if (deps.host.modules.some((m) => m.id === id)) await deps.host.removeModule(id);
    unregisterModuleMessages(id);
    active.delete(id);
    const def = bundledDef(id);
    if (def) await deps.host.addModules([def]);
  }

  async function swapIn(pack: InstalledPackView): Promise<void> {
    installPackHost();
    deps.addStyles?.(pack.styles);
    const { module, messages } = validatePackEntry(await deps.importEntry(pack.entry), pack);
    registerModuleMessages(pack.id, messages);
    try {
      if (deps.host.modules.some((m) => m.id === pack.id)) await deps.host.removeModule(pack.id);
      await deps.host.addModules([module]);
      await deps.host.idle();
      const state = deps.host.statuses().get(pack.id)?.state;
      if (state?.kind === "failed") throw new Error(state.error);
      active.set(pack.id, pack.version);
    } catch (error) {
      await restoreBundled(pack.id);
      throw error;
    }
  }

  async function sync(view: ModulePacksView): Promise<void> {
    lastView = view;
    publish({ view });
    const decisions: Record<string, PackDecision & { version: string }> = {};
    const installed = new Map(view.installed.map((p) => [p.id, p]));
    for (const pack of view.installed) {
      const f = failed.get(pack.id);
      const d = packDecision(pack, bundledVersion(pack.id), { missingHost: checkHostImports(pack.host), failed: f && f.version === pack.version ? f.error : null, appModuleApi: MODULE_API_VERSION });
      decisions[pack.id] = { ...d, version: pack.version };
      if (!d.use) {
        if (active.has(pack.id)) await restoreBundled(pack.id);
        continue;
      }
      if (active.get(pack.id) === pack.version) continue;
      try {
        await swapIn(pack);
        deps.log?.(`module pack ${pack.id} ${pack.version} loaded`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.set(pack.id, { version: pack.version, error: message });
        decisions[pack.id] = { use: false, reason: "failed", detail: message, version: pack.version };
        deps.log?.(`module pack ${pack.id} ${pack.version} failed, using the bundled copy: ${message}`);
      }
    }
    // Packs no longer installed (removed, or broken at serve time): back to the bundled copy.
    for (const id of [...active.keys()]) if (!installed.has(id)) await restoreBundled(id);
    publish({ view, active: Object.fromEntries(active), decisions });
  }

  const queue = (view: ModulePacksView) => {
    chain = chain.then(() => sync(view)).catch((error) => deps.log?.(`module packs: ${error instanceof Error ? error.message : String(error)}`));
    return chain;
  };

  // A pack module that fails later (e.g. its activate throws once the owner turns it on): bundled copy.
  const unsubscribeHost = deps.host.subscribe(() => {
    for (const [id, version] of active) {
      const state = deps.host.statuses().get(id)?.state;
      if (state?.kind !== "failed" || failed.get(id)?.version === version) continue;
      failed.set(id, { version, error: state.error });
      deps.log?.(`module pack ${id} ${version} failed, using the bundled copy: ${state.error}`);
      chain = chain.then(async () => {
        await restoreBundled(id);
        if (lastView) await sync(lastView);
      });
    }
  });
  const unsubscribeBridge = deps.bridge.onState((view) => void queue(view));

  return {
    /** Reads main's view and applies it (start-up). */
    start: async () => {
      publish({ view: null, bundled: Object.fromEntries(deps.bundled.map((m) => [m.id, deps.bundledVersions[m.id] ?? null])) });
      await queue(await deps.bridge.state());
    },
    apply: queue,
    idle: () => chain,
    dispose: () => {
      unsubscribeHost();
      unsubscribeBridge();
    },
  };
}

let loader: ReturnType<typeof createPackLoader> | null = null;

/** Settings → 模块: apply a view an IPC call returned (the same as main's push event). */
export function applyPackView(view: ModulePacksView): void {
  void loader?.apply(view);
}

/** main.tsx: start following installed packs (after startAppModules; does not hold up the first render). */
export function startModulePacks(host: AppModuleHost, bundled: readonly AppModule[], bundledVersions: Readonly<Record<string, string>>, bridge: ModulePacksBridge | undefined): void {
  if (loader || !bridge) return;
  loader = createPackLoader({
    host,
    bundled,
    bundledVersions,
    bridge,
    importEntry: (url) => import(/* @vite-ignore */ url),
    addStyles: (urls) => {
      for (const href of urls) {
        if (document.querySelector(`link[data-cutex-pack="${CSS.escape(href)}"]`)) continue;
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.dataset.cutexPack = href;
        document.head.appendChild(link);
      }
    },
    log: (text) => console.info(`[module-packs] ${text}`),
  });
  void loader.start().catch((error) => console.warn("[module-packs] start failed", error));
}
