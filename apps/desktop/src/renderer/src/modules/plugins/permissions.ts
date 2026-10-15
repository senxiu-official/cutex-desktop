import type { Operation, Json } from "@cutex-desktop/plugin-sandbox";
import type { ModulePrefs } from "../types";

export interface PluginAgent { id: string; name: string; state: string; threadId: string | null }
export interface PluginOperationScope {
  readonly signal: AbortSignal;
  /** Includes the parent module lifetime, permission revision and host A→B→A epoch. */
  current(): boolean;
  agents(): readonly PluginAgent[];
  openAgent(id: string): Promise<void>;
  prefs: ModulePrefs;
  /** Clock for the agents.open throttle (tests). */
  now?(): number;
}

/** All of a plugin's own settings live in one object of its module prefs; caps keep it from filling app storage. */
export const PLUGIN_SETTINGS_PREF = "settings";
export const PLUGIN_SETTINGS_MAX_KEYS = 64;
export const PLUGIN_SETTINGS_MAX_BYTES = 32 * 1024;
/** agents.open has no user-gesture signal across the frame boundary; at most one open per interval per frame. */
export const PLUGIN_OPEN_INTERVAL_MS = 2000;

const object = (value: Json): value is { [key: string]: Json } => value !== null && typeof value === "object" && !Array.isArray(value);
const ownKeys = (value: { [key: string]: Json }, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const key = (value: Json | undefined): value is string => typeof value === "string" && /^[a-z][a-zA-Z0-9._-]{0,63}$/.test(value) && !["constructor", "prototype", "__proto__"].includes(value);

/** Only these reviewed methods cross the frame boundary; never expose app state or bridge objects. */
export function pluginOperations(scope: PluginOperationScope): Readonly<Record<string, Operation>> {
  // An open request may only name an agent the frame saw, in the same native thread incarnation.
  const observed = new Map<string, string | null>();
  const now = scope.now ?? Date.now;
  let lastOpen = -Infinity;
  const settings = (): { [key: string]: Json } => {
    const stored = scope.prefs.get<Json>(PLUGIN_SETTINGS_PREF, {});
    return object(stored) ? stored : {};
  };
  const assertCurrent = (signal: AbortSignal) => {
    if (signal.aborted || scope.signal.aborted || !scope.current()) throw new Error("stale_plugin_scope");
  };
  return {
    "agents.list": {
      permission: "agents.read",
      validate: (params) => params === null,
      run(_params, { signal }) {
        assertCurrent(signal);
        const rows = scope.agents();
        observed.clear();
        for (const agent of rows) observed.set(agent.id, agent.threadId);
        return rows.map(({ id, name, state }) => ({ id, name, state }));
      },
    },
    "agents.open": {
      permission: "agents.open",
      validate: (params) => object(params) && ownKeys(params, ["id"]) && typeof params.id === "string" && params.id.length > 0 && params.id.length <= 256,
      async run(params, { signal }) {
        assertCurrent(signal);
        const id = (params as { id: string }).id;
        const agent = scope.agents().find((row) => row.id === id);
        if (!agent || !observed.has(id) || observed.get(id) !== agent.threadId) throw new Error("agent_not_observed");
        const at = now();
        if (at - lastOpen < PLUGIN_OPEN_INTERVAL_MS) throw new Error("rate_limited");
        lastOpen = at;
        // Dispatch only after the last lifetime and identity check; do not await before it.
        assertCurrent(signal);
        await scope.openAgent(id);
        assertCurrent(signal);
        return null;
      },
    },
    "settings.get": {
      permission: "settings",
      validate: (params) => object(params) && ownKeys(params, ["key"]) && key(params.key),
      run(params, { signal }) {
        assertCurrent(signal);
        const values = settings(), name = (params as { key: string }).key;
        return Object.hasOwn(values, name) ? values[name]! : null;
      },
    },
    "settings.set": {
      permission: "settings",
      validate: (params) => object(params) && ownKeys(params, ["key", "value"]) && key(params.key),
      run(params, { signal }) {
        assertCurrent(signal);
        const request = params as { key: string; value: Json };
        // null deletes, so a plugin can free its quota.
        const next = { ...settings() };
        if (request.value === null) delete next[request.key];
        else next[request.key] = request.value;
        if (Object.keys(next).length > PLUGIN_SETTINGS_MAX_KEYS || new TextEncoder().encode(JSON.stringify(next)).length > PLUGIN_SETTINGS_MAX_BYTES) throw new Error("quota_exceeded");
        // Module prefs throw when storage rejects the write: the plugin gets an error, never a false success.
        scope.prefs.set(PLUGIN_SETTINGS_PREF, next);
        return null;
      },
    },
  };
}
