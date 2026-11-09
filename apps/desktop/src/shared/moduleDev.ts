// Developer mode for modules (docs/desktop-modules.md §30.5): load a module from a folder and follow its builds.
// Only main picks folders and asks the owner, so no request carries a path except to name a folder already listed.
export const MODULE_DEV_CHANNEL = "cutex-desktop:module-dev";

export interface DevModuleView {
  folder: string;
  /** From the last good build; null until there is one. */
  id: string | null;
  version: string | null;
  moduleApi: string | null;
  /** Goes up with each new build; the URLs change with it, so each is a new ES module instance. */
  rev: number;
  /** cutex-module:// URLs of the last good build. */
  entry: string | null;
  styles: string[];
  host: Record<string, string[]>;
  /** Why the newest build in the folder is not the one loaded. */
  error: string | null;
  /** The same in the UI's language, for the reasons the app itself words. */
  errorKey?: string;
  errorVars?: Record<string, string>;
}

export interface ModuleDevView {
  enabled: boolean;
  /** A dev build: a folder module reading beyond the public API loads, tagged (as `LocalPacksView.internal`). */
  internal: boolean;
  /** This run started with LOCAL_SAFE_START_ARG: nothing loads from folders. */
  skipped: boolean;
  modules: DevModuleView[];
}

export type ModuleDevRequest =
  | { op: "state" }
  | { op: "setEnabled"; enabled: boolean }
  | { op: "addFolder" }
  | { op: "removeFolder"; folder: string }
  | { op: "report"; folder: string; rev: number; error: string | null };

export interface ModuleDevBridge {
  state(): Promise<ModuleDevView>;
  setEnabled(enabled: boolean): Promise<ModuleDevView>;
  addFolder(): Promise<ModuleDevView>;
  removeFolder(folder: string): Promise<ModuleDevView>;
  /** The renderer's result of loading a rev: null = it runs. */
  report(folder: string, rev: number, error: string | null): Promise<ModuleDevView>;
  onState(listener: (view: ModuleDevView) => void): () => void;
}

export function parseModuleDevRequest(raw: unknown): ModuleDevRequest {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object") throw new Error("invalid module dev request");
  const keys = Object.keys(r).sort().join(",");
  switch (r.op) {
    case "state":
    case "addFolder":
      if (keys === "op") return { op: r.op };
      break;
    case "setEnabled":
      if (keys === "enabled,op" && typeof r.enabled === "boolean") return { op: "setEnabled", enabled: r.enabled };
      break;
    case "removeFolder":
      if (keys === "folder,op" && typeof r.folder === "string") return { op: "removeFolder", folder: r.folder };
      break;
    case "report":
      if (keys === "error,folder,op,rev" && typeof r.folder === "string" && Number.isSafeInteger(r.rev) && (r.error === null || typeof r.error === "string")) {
        return { op: "report", folder: r.folder, rev: r.rev as number, error: r.error === null ? null : (r.error as string).slice(0, 2000) };
      }
      break;
  }
  throw new Error("invalid module dev request");
}
