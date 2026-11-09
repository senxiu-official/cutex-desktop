// Modules loaded from a folder in developer mode (docs/desktop-modules.md §30.5): follows main's view and swaps each new build
// in through the host's dynamic registration (§15). Reloading never restarts the app; a build that does not run leaves
// the last one that did, and the reason goes back to main for Settings to show.
import { useSyncExternalStore } from "react";
import type { DevModuleView, ModuleDevBridge, ModuleDevView } from "../../../shared/moduleDev";
import { registerModuleMessages, translate, unregisterModuleMessages } from "../i18n";
import { checkHostImports, checkPublicHostImports, installPackHost } from "./packHost";
import { validatePackEntry } from "./packs";
import type { AppModule, AppModuleHost } from "./slots";
import type { InstalledPackView } from "../../../shared/modulePacks";

interface Running {
  id: string;
  rev: number;
  module: AppModule;
  messages: Parameters<typeof registerModuleMessages>[1];
  styles: readonly string[];
}

export interface DevLoaderDeps {
  host: AppModuleHost;
  bridge: ModuleDevBridge;
  importEntry(url: string): Promise<unknown>;
  setStyles?(folder: string, urls: readonly string[]): void;
  log?(text: string): void;
}

/** Another module holds the id. Unlike a broken build this clears by itself: when that module goes, the folder loads. */
class IdTaken extends Error {}

export function createDevModuleLoader(deps: DevLoaderDeps) {
  const running = new Map<string, Running>();
  const refused = new Map<string, number>();
  const waiting = new Map<string, string>();
  let last: ModuleDevView | null = null;
  let chain: Promise<void> = Promise.resolve();

  const stateOf = (id: string) => deps.host.statuses().get(id)?.state;

  /** Puts `to` in place of what is registered under `id` now. */
  async function register(id: string, to: Running | null): Promise<void> {
    if (deps.host.modules.some((m) => m.id === id)) await deps.host.removeModule(id);
    unregisterModuleMessages(id);
    if (!to) return;
    registerModuleMessages(id, to.messages);
    await deps.host.addModules([to.module]);
    await deps.host.idle();
  }

  async function load(m: DevModuleView & { id: string; entry: string }): Promise<void> {
    const before = running.get(m.folder) ?? null;
    const holder = before ? null : deps.host.modules.find((d) => d.id === m.id);
    if (holder) throw new IdTaken(translate("modules.dev.err.idTaken", { id: m.id, name: holder.displayName ?? translate(holder.titleKey) }));
    // A dev build loads a module reading the app's own files too (tagged in Settings); a public build only the public API.
    const missing = last?.internal ? checkHostImports(m.host) : checkPublicHostImports(m.host);
    if (missing.length) throw new Error(translate("modules.dev.err.publicApi", { list: missing.join(", ") }));
    installPackHost();
    const pack = { id: m.id, moduleApi: m.moduleApi } as InstalledPackView;
    const { module, messages } = validatePackEntry(await deps.importEntry(m.entry), pack);
    const next: Running = { id: m.id, rev: m.rev, module, messages, styles: m.styles };
    try {
      await register(m.id, next);
      const state = stateOf(m.id);
      if (state?.kind === "failed") throw new Error(state.error);
    } catch (error) {
      // Back to the last build that ran, if any.
      await register(m.id, before);
      throw error;
    }
    running.set(m.folder, next);
    deps.setStyles?.(m.folder, m.styles);
  }

  async function sync(view: ModuleDevView): Promise<void> {
    const wanted = new Map(view.modules.filter((m) => m.entry && m.id).map((m) => [m.folder, m as DevModuleView & { id: string; entry: string }]));
    for (const [folder, now] of [...running]) {
      const m = wanted.get(folder);
      if (m && m.id === now.id) continue;
      await register(now.id, null);
      running.delete(folder);
      deps.setStyles?.(folder, []);
    }
    for (const m of wanted.values()) {
      if (running.get(m.folder)?.rev === m.rev || refused.get(m.folder) === m.rev) continue;
      try {
        await load(m);
        refused.delete(m.folder);
        waiting.delete(m.folder);
        deps.log?.(`loaded ${m.id} from ${m.folder}`);
        void deps.bridge.report(m.folder, m.rev, null).catch(() => {});
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        refused.set(m.folder, m.rev);
        if (error instanceof IdTaken) waiting.set(m.folder, m.id);
        deps.log?.(`${m.id} from ${m.folder} did not load: ${message}`);
        void deps.bridge.report(m.folder, m.rev, message).catch(() => {});
      }
    }
  }

  const queue = (view: ModuleDevView) => {
    publish(view);
    last = view;
    chain = chain.then(() => sync(view)).catch((error) => deps.log?.(String(error)));
    return chain;
  };

  // The module holding a waiting folder's id has gone: try that build again.
  const offHost = deps.host.subscribe(() => {
    let freed = false;
    for (const [folder, id] of [...waiting]) {
      if (deps.host.modules.some((d) => d.id === id)) continue;
      waiting.delete(folder);
      refused.delete(folder);
      freed = true;
    }
    if (freed && last) void queue(last);
  });
  const offBridge = deps.bridge.onState((view) => void queue(view));
  return {
    start: async () => queue(await deps.bridge.state()),
    apply: queue,
    idle: () => chain,
    dispose: () => {
      offBridge();
      offHost();
    },
  };
}

// ---- for Settings → 模块 ----

let current: ModuleDevView | null = null;
const listeners = new Set<() => void>();
function publish(view: ModuleDevView): void {
  current = view;
  for (const l of listeners) l();
}
export function useModuleDevView(): ModuleDevView | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

let loader: ReturnType<typeof createDevModuleLoader> | null = null;

export function applyModuleDevView(view: ModuleDevView): void {
  void loader?.apply(view);
}

/** main.tsx: follow developer mode (after startAppModules; does not hold up the first render). */
export function startDevModules(host: AppModuleHost, bridge: ModuleDevBridge | undefined): void {
  if (loader || !bridge) return;
  const links = new Map<string, HTMLLinkElement[]>();
  loader = createDevModuleLoader({
    host,
    bridge,
    importEntry: (url) => import(/* @vite-ignore */ url),
    setStyles: (folder, urls) => {
      for (const link of links.get(folder) ?? []) link.remove();
      links.set(folder, urls.map((href) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.dataset.cutexPack = href;
        document.head.appendChild(link);
        return link;
      }));
    },
    log: (text) => console.info(`[module-dev] ${text}`),
  });
  void loader.start().catch((error) => console.warn("[module-dev] start failed", error));
}
