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
import { markDevLoaderStarted, setDevRunning, type DevRunning } from "./devRunning";

interface Running {
  id: string;
  rev: number;
  version: string | null;
  host: Record<string, string[]>;
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
  /** What runs from a folder under an id changed (null: nothing any more); Settings' tags follow it (devRunning.ts). */
  onRunning?(id: string, run: DevRunning | null): void;
}

/** Another module holds the id. Unlike a broken build this clears by itself: when that module goes, the folder loads. */
class IdTaken extends Error {}

export function createDevModuleLoader(deps: DevLoaderDeps) {
  const running = new Map<string, Running>();
  const refused = new Map<string, number>();
  const waiting = new Map<string, string>();
  /** Folders whose running build another owner replaced, until someone holds the id (then: waiting). */
  const lost = new Map<string, Running>();
  let last: ModuleDevView | null = null;
  let chain: Promise<void> = Promise.resolve();

  const stateOf = (id: string) => deps.host.statuses().get(id)?.state;

  // This loader's own registry changes in progress: the host notifies mid-swap (the old build removed, the new one not
  // yet added); those notifications are not another owner taking the id.
  let own = 0;

  const holderOf = (id: string) => deps.host.modules.find((d) => d.id === id);
  const taken = (id: string, holder: AppModule) => new IdTaken(translate("modules.dev.err.idTaken", { id, name: holder.displayName ?? translate(holder.titleKey) }));

  /**
   * Puts `to` in place of `expected` under `id` (`expected` null: the id must be free). Other loaders (packs, the
   * bundled copy) work on the same host concurrently, so who holds the id is checked again after every await: when
   * anyone else holds it, this throws IdTaken and leaves their module, and their messages, alone.
   */
  async function register(id: string, expected: AppModule | null, to: Running | null): Promise<void> {
    own++;
    try {
      const now = holderOf(id);
      if (now !== (expected ?? undefined)) {
        if (now) throw taken(id, now);
        // `expected` (ours) is already gone: nothing of ours to remove.
      } else if (now) {
        await deps.host.removeModule(id);
      }
      const between = holderOf(id);
      if (between) throw taken(id, between);
      unregisterModuleMessages(id);
      if (!to) return;
      registerModuleMessages(id, to.messages);
      await deps.host.addModules([to.module]);
      await deps.host.idle();
      const after = holderOf(id);
      if (after && after !== to.module) throw taken(id, after);
    } finally {
      own--;
    }
  }

  /**
   * A folder build counts as running only while the host's definition under its id is that build's own object. Anything
   * else (a pack or another loader registered the id, or it was removed behind this loader's back) ends the claim: the
   * record for Settings goes, its styles go, and that build is refused like one whose id is taken. Not reloaded at once:
   * another loader swapping the id removes before it adds, and the id is free only in between. Once someone else holds
   * the id the folder waits for it (and main hears why); see `lostTo` in the host subscription.
   */
  function reconcile(): void {
    for (const [folder, run] of [...running]) {
      if (deps.host.modules.find((d) => d.id === run.id) === run.module) continue;
      running.delete(folder);
      refused.set(folder, run.rev);
      lost.set(folder, run);
      deps.onRunning?.(run.id, null);
      deps.setStyles?.(folder, []);
    }
    for (const [folder, run] of [...lost]) {
      const holder = deps.host.modules.find((d) => d.id === run.id);
      if (!holder) continue; // still between someone's remove and add (or simply removed): wait for an owner to show
      lost.delete(folder);
      waiting.set(folder, run.id);
      const message = translate("modules.dev.err.idTaken", { id: run.id, name: holder.displayName ?? translate(holder.titleKey) });
      deps.log?.(`${run.id} from ${folder} was replaced: ${message}`);
      void deps.bridge.report(folder, run.rev, message).catch(() => {});
    }
  }

  // The freed id is taken up after the host settles and the current task ends: a loader that removed the holder to put
  // its own copy in (remove, then add) gets there first, and the folder goes back to waiting.
  let freeing = false;
  function freeLater(): void {
    if (freeing) return;
    freeing = true;
    void deps.host.idle().then(() => new Promise((r) => setTimeout(r, 0))).then(() => {
      freeing = false;
      if (last) void queue(last);
    });
  }

  async function load(m: DevModuleView & { id: string; entry: string }): Promise<void> {
    const before = running.get(m.folder) ?? null;
    const holder = before ? null : holderOf(m.id);
    if (holder) throw taken(m.id, holder);
    // A dev build loads a module reading the app's own files too (tagged in Settings); a public build only the public API.
    const missing = last?.internal ? checkHostImports(m.host) : checkPublicHostImports(m.host);
    if (missing.length) throw new Error(translate("modules.dev.err.publicApi", { list: missing.join(", ") }));
    installPackHost();
    const pack = { id: m.id, moduleApi: m.moduleApi } as InstalledPackView;
    const { module, messages } = validatePackEntry(await deps.importEntry(m.entry), pack);
    const next: Running = { id: m.id, rev: m.rev, version: m.version, host: m.host, module, messages, styles: m.styles };
    // The import was async: register() checks again that the id is still ours (`before`) or still free.
    try {
      await register(m.id, before?.module ?? null, next);
      const state = stateOf(m.id);
      if (state?.kind === "failed") throw new Error(state.error);
    } catch (error) {
      // Someone else holds the id now: leave it (and their module) alone; the folder waits for the id.
      if (error instanceof IdTaken) throw error;
      // Back to the last build that ran, if any, but only in place of our own failed build.
      try {
        await register(m.id, next.module, before);
      } catch (fallback) {
        if (!(fallback instanceof IdTaken)) throw fallback;
      }
      throw error;
    }
    running.set(m.folder, next);
    deps.onRunning?.(m.id, { folder: m.folder, rev: m.rev, version: m.version, host: m.host, module: next.module });
    deps.setStyles?.(m.folder, m.styles);
  }

  async function sync(view: ModuleDevView): Promise<void> {
    // Drop claims another owner took meanwhile (notifications during this loader's own swaps were skipped): never
    // remove or replace a module this loader no longer owns.
    reconcile();
    const wanted = new Map(view.modules.filter((m) => m.entry && m.id).map((m) => [m.folder, m as DevModuleView & { id: string; entry: string }]));
    for (const [folder, now] of [...running]) {
      const m = wanted.get(folder);
      if (m && m.id === now.id) continue;
      try {
        await register(now.id, now.module, null);
      } catch (error) {
        if (!(error instanceof IdTaken)) throw error; // another owner holds the id: theirs, not ours to remove
      }
      running.delete(folder);
      deps.onRunning?.(now.id, null);
      deps.setStyles?.(folder, []);
    }
    for (const folder of [...lost.keys()]) if (wanted.get(folder)?.rev !== lost.get(folder)!.rev) lost.delete(folder);
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
    // Another owner registered one of these ids while this pass was swapping (its notification was skipped).
    reconcile();
  }

  const queue = (view: ModuleDevView) => {
    publish(view);
    last = view;
    chain = chain.then(() => sync(view)).catch((error) => deps.log?.(String(error)));
    return chain;
  };

  // Someone else took a running build's id (reconcile), or the module holding a waiting folder's id has gone: sync again
  // (a taken id becomes a waiting folder, a freed one loads).
  const offHost = deps.host.subscribe(() => {
    if (own) return; // this loader's own swap; sync reconciles before its next change
    reconcile();
    let freed = false;
    for (const [folder, id] of [...waiting]) {
      if (deps.host.modules.some((d) => d.id === id)) continue;
      waiting.delete(folder);
      refused.delete(folder);
      freed = true;
    }
    if (freed) freeLater();
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
    onRunning: setDevRunning,
  });
  markDevLoaderStarted();
  void loader.start().catch((error) => console.warn("[module-dev] start failed", error));
}
