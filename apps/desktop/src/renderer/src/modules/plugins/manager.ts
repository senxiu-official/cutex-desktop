import { parsePluginManifest, type PluginCapability } from "@cutex-desktop/plugin-sandbox";
import type { PluginCatalog } from "../../../../shared/plugins";
import type { AppModule, AppModuleContext, AppModuleHost } from "../slots";
import type { Json } from "../types";
import { EXTERNAL_MODULE_PREFIX } from "../external";
import { PluginRuntime, type PluginRecord } from "./runtime";

export const externalModuleId = (id: string) => `${EXTERNAL_MODULE_PREFIX}${id}`;
export const externalItemId = (id: `${string}.${string}`): `${string}.${string}` => `${EXTERNAL_MODULE_PREFIX}${id}`;
export interface PluginManagerSnapshot { loading: boolean; plugins: readonly PluginRecord[]; errors: readonly { id: string; message: string }[] }
interface Options {
  catalog(): Promise<PluginCatalog>;
  host(): AppModuleHost;
  definition(runtime: PluginRuntime): AppModule;
  contributeManagement(context: AppModuleContext): void;
}
const EMPTY: PluginManagerSnapshot = { loading: false, plugins: [], errors: [] };

/** Catalog I/O and host mutations happen after activate returns, never from inside its lifecycle queue. */
export class PluginManager {
  private state: PluginManagerSnapshot = EMPTY;
  private context: AppModuleContext | null = null;
  private epoch = 0;
  private readonly listeners = new Set<() => void>();
  private readonly runtimes = new Map<string, PluginRuntime>();
  private readonly registered = new Set<string>();
  private work = Promise.resolve();
  private contributed = false;
  constructor(private readonly options: Options) {}
  readonly snapshot = () => this.state;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(state: PluginManagerSnapshot) { this.state = state; for (const listener of this.listeners) listener(); }
  private current(context: AppModuleContext, epoch: number) { return this.context === context && this.epoch === epoch && !context.signal.aborted; }
  private queue(run: () => Promise<void>) {
    const result = this.work.then(run);
    this.work = result.catch(() => {});
    return result;
  }
  async idle() { await this.work; }
  activate(context: AppModuleContext) {
    this.stop();
    this.context = context;
    const epoch = ++this.epoch;
    this.contributed = false;
    this.update({ ...EMPTY, loading: true });
    const start = setTimeout(() => { if (this.current(context, epoch)) void this.refresh(); }, 0);
    context.signal.addEventListener("abort", () => {
      clearTimeout(start);
      if (this.context === context) this.stop();
    }, { once: true });
  }
  stop() {
    this.context = null;
    this.epoch++;
    for (const runtime of this.runtimes.values()) runtime.close();
    this.runtimes.clear();
    this.update(EMPTY);
    // The disposer itself returns synchronously; removeModule may queue behind the stopping pass.
    void this.queue(() => this.removeRegistered());
  }
  private async removeRegistered() {
    for (const id of [...this.registered]) {
      await this.options.host().removeModule(id);
      this.registered.delete(id);
    }
  }
  private consents(context: AppModuleContext): Record<string, Json> {
    const value = context.prefs.get<Json>("consents", {});
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }
  private record(input: PluginCatalog["plugins"][number], context: AppModuleContext): PluginRecord {
    const manifest = parsePluginManifest(input.manifest);
    if (!/^[a-f0-9]{64}$/.test(input.fingerprint)) throw new Error("Invalid plugin fingerprint");
    const stored = this.consents(context)[manifest.id];
    const consent = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : null;
    const same = consent?.fingerprint === input.fingerprint;
    const granted = same && Array.isArray(consent?.permissions) ? consent.permissions : [];
    return { manifest, fingerprint: input.fingerprint, permissions: manifest.capabilities.filter((permission) => granted.includes(permission)), changed: !!consent && !same };
  }
  private async register(records: readonly PluginRecord[], context: AppModuleContext, epoch: number) {
    if (!this.current(context, epoch)) return;
    const candidates = records.filter((record) => record.permissions.includes("views") && this.state.plugins.includes(record));
    const definitions = candidates.map((record) => {
      const runtime = new PluginRuntime(record, () => this.current(context, epoch));
      this.runtimes.set(record.manifest.id, runtime);
      return this.options.definition(runtime);
    });
    if (!definitions.length) return;
    for (const definition of definitions) this.registered.add(definition.id);
    try { await this.options.host().addModules(definitions); }
    catch (error) {
      for (const candidate of candidates) {
        this.runtimes.get(candidate.manifest.id)?.close(); this.runtimes.delete(candidate.manifest.id);
        const id = externalModuleId(candidate.manifest.id);
        await this.options.host().removeModule(id); this.registered.delete(id);
      }
      throw error;
    }
    if (!this.current(context, epoch)) await this.removeRegistered();
  }
  refresh(): Promise<void> {
    const context = this.context; const epoch = this.epoch;
    if (!context || context.signal.aborted) return Promise.resolve();
    // Refresh suspends current frames before inspecting potentially changed files.
    for (const runtime of this.runtimes.values()) runtime.close();
    this.runtimes.clear();
    this.update({ ...this.state, loading: true });
    return this.queue(async () => {
      await this.removeRegistered();
      if (!this.current(context, epoch)) return;
      try {
        const catalog = await scopedCatalog(this.options.catalog(), context.signal);
        if (!this.current(context, epoch)) return;
        const errors = [...catalog.errors];
        const records: PluginRecord[] = [];
        const seen = new Set<string>();
        for (const input of catalog.plugins) {
          try {
            const record = this.record(input, context);
            if (seen.has(record.manifest.id)) throw new Error("Duplicate plugin id");
            seen.add(record.manifest.id); records.push(record);
          } catch (error) { errors.push({ id: typeof input.manifest === "object" && input.manifest && "id" in input.manifest ? String(input.manifest.id) : "invalid", message: String(error) }); }
        }
        this.update({ loading: false, plugins: records, errors });
        if (!this.contributed && (records.length || errors.length)) {
          this.options.contributeManagement(context); this.contributed = true;
        }
        await this.register(records, context, epoch);
      } catch (error) {
        if (this.current(context, epoch)) {
          this.update({ ...this.state, loading: false, errors: [...this.state.errors, { id: "catalog", message: error instanceof Error ? error.message : String(error) }] });
          if (!this.contributed) { this.options.contributeManagement(context); this.contributed = true; }
        }
      }
    });
  }
  setPermissions(id: string, permissions: readonly PluginCapability[]): Promise<void> {
    const context = this.context; const epoch = this.epoch;
    const record = this.state.plugins.find((plugin) => plugin.manifest.id === id);
    if (!context || !record || !this.current(context, epoch)) return Promise.reject(new Error("Plugin catalog is inactive"));
    if (permissions.some((permission) => !record.manifest.capabilities.includes(permission))) return Promise.reject(new Error("Permission was not requested by the plugin"));
    const requested = record.manifest.capabilities.filter((permission) => permissions.includes(permission));
    // Module prefs throw when storage rejects the write. Then nothing new is granted, but a
    // revocation still applies for this session (fail safe), and the caller gets the error.
    let saveError: unknown = null;
    try { context.prefs.set("consents", { ...this.consents(context), [id]: { fingerprint: record.fingerprint, permissions: [...requested] } }); }
    catch (error) { saveError = error ?? new Error("Could not save plugin permissions"); }
    const next: PluginRecord = saveError
      ? { ...record, permissions: requested.filter((permission) => record.permissions.includes(permission)) }
      : { ...record, permissions: requested, changed: false };
    // Revoke every frame immediately, before waiting for host mutations or an in-flight operation.
    this.runtimes.get(id)?.close(); this.runtimes.delete(id);
    this.update({ ...this.state, plugins: this.state.plugins.map((plugin) => plugin.manifest.id === id ? next : plugin) });
    return this.queue(async () => {
      const moduleId = externalModuleId(id);
      if (this.registered.has(moduleId)) { await this.options.host().removeModule(moduleId); this.registered.delete(moduleId); }
      if (this.current(context, epoch)) {
        await this.register([next], context, epoch);
        // This explicit button also re-enables a plugin previously switched off in Modules.
        // Catalog refresh/host restart never overrides the saved enabled preference.
        if (!saveError && this.current(context, epoch) && this.state.plugins.includes(next) && next.permissions.includes("views") && this.registered.has(moduleId)) await this.options.host().setEnabled(moduleId, true);
      }
      if (saveError) throw saveError;
    });
  }
}

function scopedCatalog(work: Promise<PluginCatalog>, signal: AbortSignal): Promise<PluginCatalog> {
  return new Promise((resolve, reject) => {
    const finish = (error?: unknown, value?: PluginCatalog) => { clearTimeout(timer); signal.removeEventListener("abort", abort); error ? reject(error) : resolve(value!); };
    const abort = () => finish(new Error("Plugin catalog scope ended"));
    const timer = setTimeout(() => finish(new Error("Plugin catalog timed out")), 10000);
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    void work.then((value) => finish(undefined, value), (error) => finish(error));
  });
}
