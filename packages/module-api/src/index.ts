// @cutex-desktop/module-api: everything a module may use besides React.
//
// The `declare`d values have no code in this package. A module's build turns each import into a read from the running
// app (docs/module-authoring.md), so a module always gets the app's own instance and never brings a second copy.
// Adding a name here without the app implementing it does not compile: see apps/desktop/src/renderer/src/moduleApi.
import type { Jsonable, MessageKey, ModuleId, PageParams } from "./types";
import type { PageCrumb } from "./slots";
import type { AgentSummary, ModuleDefinition, ModuleServices } from "./services";

export type * from "./types";
export type * from "./slots";
export type * from "./services";

/** The running app's API version. Compare with care: pack.json's `moduleApi` already decides whether you load. */
export declare const MODULE_API_VERSION: string;

/** Type-checks a module definition. `export default defineModule({ … })` is what your entry file does. */
export declare function defineModule(definition: ModuleDefinition): ModuleDefinition;

/** The services, for components. In `activate`, prefer `ctx.services`: its calls end with the module. */
export declare const services: ModuleServices;

/** Hook. The UI's language and the message lookup. Messages are `{name}` templates. */
export declare function useI18n(): { locale: string; t(key: MessageKey, vars?: Record<string, string | number>): string };

/** Hook. One key of a module's prefs. `fallback` must be a primitive or a stable reference. */
export declare function useModulePref<T>(moduleId: ModuleId, key: string, fallback: T & Jsonable<T>): [T, (value: (T & Jsonable<T>) | ((previous: T) => T & Jsonable<T>)) => void];

/** A `main.page` `useTitle` for a page whose title is just its name. */
export declare function pageTitle(key: MessageKey): (params: PageParams) => readonly PageCrumb[];

/** Hook. Every agent on the connected hosts; re-renders when they change. */
export declare function useAgents(): readonly AgentSummary[];

/** Hook. The hosts the owner can pick from, the focus host first. */
export declare function useHosts(): readonly { id: string; label: string; online: boolean; focus: boolean }[];
