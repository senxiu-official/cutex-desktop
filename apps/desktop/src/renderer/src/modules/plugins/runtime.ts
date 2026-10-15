import type { PluginCatalog, PluginCapability } from "@cutex-desktop/plugin-sandbox";
import type { AppModuleContext } from "../slots";

export type CatalogPlugin = PluginCatalog["plugins"][number];
export interface PluginRecord extends CatalogPlugin { permissions: readonly PluginCapability[]; changed: boolean }
export interface PluginScope { context: AppModuleContext; signal: AbortSignal; generation: number }

/** One registered plugin; every activation and permission change owns a separate frame lifetime. */
export class PluginRuntime {
  private scope: PluginScope | null = null;
  private controller: AbortController | null = null;
  private generation = 0;
  private stopped = false;
  private readonly listeners = new Set<() => void>();
  private readonly frames = new Set<() => void>();
  constructor(readonly plugin: PluginRecord, private readonly parentCurrent: () => boolean) {}
  readonly snapshot = () => this.scope;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private changed() { for (const listener of this.listeners) listener(); }
  current(scope: PluginScope): boolean {
    return !this.stopped && this.scope === scope && !scope.signal.aborted && !scope.context.signal.aborted && this.parentCurrent();
  }
  activate(context: AppModuleContext) {
    this.withdraw();
    if (this.stopped || context.signal.aborted || !this.parentCurrent()) return;
    const controller = new AbortController();
    this.controller = controller;
    const scope = { context, signal: controller.signal, generation: ++this.generation };
    this.scope = scope;
    context.signal.addEventListener("abort", () => { if (this.scope === scope) this.withdraw(); }, { once: true });
    this.changed();
  }
  track(scope: PluginScope, dispose: () => void): () => void {
    if (!this.current(scope)) { dispose(); return () => {}; }
    this.frames.add(dispose);
    return () => { this.frames.delete(dispose); };
  }
  private withdraw() {
    this.controller?.abort();
    this.controller = null;
    this.scope = null;
    for (const dispose of [...this.frames]) dispose();
    this.frames.clear();
    this.changed();
  }
  close() { this.stopped = true; this.withdraw(); }
}
