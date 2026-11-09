// The stable services: `ctx.services` (ends with the module) and `services` (for components).
import type { ItemId, Json, MessageKey, ModuleHostContext, ModuleHostsContext, ModuleId, ModulePrefs, ModuleRequires, PageParams } from "./types";
import type { SlotId, SlotMap } from "./slots";

export type AgentStatus = "needsInput" | "running" | "idle" | "offline" | "error" | "unknown";

/** One agent as a module sees it. */
export interface AgentSummary {
  id: string;
  hostId: string;
  name: string;
  /** A colour hint for its avatar. */
  color: string | null;
  projectId: string | null;
  status: AgentStatus;
  /** Archived agents are in the list too. */
  archived: boolean;
}

/** "ownerMessage": the owner sent a message from this desktop. "command", "tool": an agent ran one on a connected host. */
export interface ActivityEvent {
  kind: "ownerMessage" | "command" | "tool";
  hostId: string;
}

export interface PaneOpenOptions {
  /** Beside the focused pane rather than in it. */
  beside?: boolean;
  /** Give it the keyboard focus. Default false. */
  focus?: boolean;
  /** Open without taking the view. Wins over `focus`. */
  background?: boolean;
}

/** Says why when it did not open. */
export type PaneOpenResult =
  | { status: "opened"; kind: string; paneId: string | null; instanceId: string | null }
  | { status: "unavailable"; reason: string }
  | { status: "stale" };

export interface ModuleServices {
  ui: {
    /** A short line above the input of the conversation in view. With no conversation open nobody sees it: use `toast`. */
    notice(text: string, tone?: "info" | "error"): void;
    /** A short message at the bottom of the window, on any screen, for a few seconds. One at a time: a new one replaces it. */
    toast(text: string): void;
    /** A modal dialog. Resolves true when confirmed. */
    confirm(message: string, danger?: boolean): Promise<boolean>;
    /** Shows a `main.page`. */
    openPage(page: ItemId, params?: PageParams): void;
    /** Back to the conversation. */
    closePage(): void;
    /** Opens a Settings page by its name. `anchor`: a card to scroll to; `sub`: one of its sub-pages. */
    openSettings(page: string, focus?: { anchor?: string; sub?: string }): void;
  };
  panes: {
    /** `core.conversation` (params `{ sessionId, hostId? }`) or `page:<main.page id>` (params = page params). */
    open(kind: string, params?: Json, options?: PaneOpenOptions): PaneOpenResult;
  };
  agents: {
    /** Every agent on the connected hosts. The same array until something changes, so it works with useSyncExternalStore. */
    list(): readonly AgentSummary[];
    get(id: string): AgentSummary | null;
    subscribe(listener: () => void): () => void;
    /** Shows the agent's conversation. */
    open(id: string): void;
  };
  activity: {
    /** Called once per event. Costs nothing until you subscribe. */
    subscribe(listener: (event: ActivityEvent) => void): () => void;
  };
}

/** One entry of `data.list`. `modified` is milliseconds since 1970. */
export interface ModuleDataEntry {
  name: string;
  kind: "file" | "folder";
  /** Bytes; 0 for a folder. */
  size: number;
  modified: number;
}

/**
 * Your module's own folder on this device. Paths are relative, `/` between parts: `notes/today.json`. A part starts with
 * a letter, digit or `_`, and has only letters, digits, `.`, `_`, `-` and spaces. A failed call rejects with an Error
 * whose `code` says why: `invalid` (a bad path, or a link in the way), `not_found`, `too_large`, `quota_exceeded`,
 * `unknown_module`, `unavailable`.
 */
export interface ModuleData {
  /** The file's bytes; null when there is no such file. */
  read(path: string): Promise<Uint8Array | null>;
  /** The file as UTF-8 text; null when there is no such file. */
  readText(path: string): Promise<string | null>;
  /** Writes the whole file, making folders on the way. A string is saved as UTF-8. Replaces the file in one step. */
  write(path: string, data: string | Uint8Array): Promise<void>;
  /** A file, or a folder with everything in it. Nothing happens when it is not there. */
  remove(path: string): Promise<void>;
  /** What is in a folder; `""` (the default) = the top. */
  list(folder?: string): Promise<readonly ModuleDataEntry[]>;
  /** Bytes used, the limit for the whole folder and the limit for one file. */
  usage(): Promise<{ used: number; limit: number; fileLimit: number }>;
}

/** Offered file types in a dialog: `{ name: "Notes", extensions: ["md", "txt"] }`. `"*"` = any. */
export interface FileFilter {
  name: string;
  extensions: readonly string[];
}

/** The file the owner chose: its name (not where it is) and its bytes. */
export interface PickedFile {
  name: string;
  size: number;
  data: Uint8Array;
  /** The bytes as UTF-8 text. */
  text(): string;
}

/** The system's open and save dialogs. Only the owner's choice reaches your module, and never where the file is. */
export interface ModuleFiles {
  /** Asks the owner for one file. null when they cancel. */
  pick(options?: { filters?: readonly FileFilter[] }): Promise<PickedFile | null>;
  /** Asks the owner where to save, and saves there. The name they chose, or null when they cancel. */
  save(data: string | Uint8Array, options?: { suggestedName?: string; filters?: readonly FileFilter[] }): Promise<{ name: string } | null>;
}

/** `ctx.services`: the services, and the ones that belong to your module alone. */
export interface ModuleContextServices extends ModuleServices {
  /** Your module's own folder (`userData/module-data/<id>/`). */
  data: ModuleData;
  /** Open and save dialogs. */
  files: ModuleFiles;
}

/** What a module's `activate` is given. Everything in it ends when the module stops. */
export interface ModuleContext {
  readonly id: ModuleId;
  /** Aborted when the module stops. */
  readonly signal: AbortSignal;
  /** Goes up by one on each activation. */
  readonly generation: number;
  /** The host in focus. */
  readonly host: ModuleHostContext;
  readonly hosts: ModuleHostsContext;
  /** `data` and `files` are only here, not in the `services` you import: they know which module asks. */
  readonly services: ModuleContextServices;
  readonly prefs: ModulePrefs;
  /** Adds an item while the module runs. Returns a function to take it away. */
  contribute<S extends SlotId>(slot: S, item: SlotMap[S]): () => void;
  t(key: MessageKey, vars?: Record<string, string | number>): string;
}

export interface ModuleDefinition {
  /** Your module's id, the same as in pack.json. */
  id: ModuleId;
  /** Its name in Settings → Modules. */
  titleKey: MessageKey;
  descriptionKey?: MessageKey;
  requires?: ModuleRequires;
  /** Default true. */
  defaultEnabled?: boolean;
  /** Items that are there whenever the module is on. */
  contributes?: { readonly [S in SlotId]?: readonly SlotMap[S][] };
  /** Subscriptions and items that depend on data. Do not wait on the network here. */
  activate?(context: ModuleContext): void | Promise<void>;
}
